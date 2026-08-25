import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';

export class TaggerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for tagger tag data
    const bucket = new s3.Bucket(this, 'TaggerData', {
      bucketName: 'mtg-deck-builder-tagger',
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        ignorePublicAcls: false,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
      }),
      cors: [
        {
          allowedOrigins: [
            'https://manafoundry.gg',
            'https://www.manafoundry.gg',
            'https://20q2.github.io', // legacy domain — keep during migration window
            'http://localhost:5173',
            'http://localhost:4173',
          ],
          allowedMethods: [s3.HttpMethods.GET],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Allow public reads so the browser can fetch the JSON directly
    bucket.addToResourcePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [bucket.arnForObjects('*')],
      principals: [new cdk.aws_iam.StarPrincipal()],
    }));

    // Lambda function for the sync job
    const syncFn = new nodejs.NodejsFunction(this, 'TaggerSyncHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'tagger-sync.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(15), // 19 tags with heavy pagination + retry backoff (Lambda max)
      memorySize: 256,
      environment: {
        BUCKET_NAME: bucket.bucketName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    bucket.grantReadWrite(syncFn);

    // Weekly cron — every Monday at 6am UTC
    new events.Rule(this, 'WeeklyTaggerSync', {
      schedule: events.Schedule.cron({ minute: '0', hour: '6', weekDay: 'MON' }),
      targets: [new targets.LambdaFunction(syncFn)],
    });

    // SpellChroma tag-index builder — inverts Scryfall's oracle_tags bulk file
    // into a dictionary + per-card index written to the same bucket.
    const spellChromaFn = new nodejs.NodejsFunction(this, 'SpellChromaIndexHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'spellchroma-index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5), // one 18MB download + parse + gzip + 2 puts
      memorySize: 1024,                 // parsing the 18MB bulk file needs headroom
      environment: {
        BUCKET_NAME: bucket.bucketName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    bucket.grantReadWrite(spellChromaFn);

    // Weekly cron — Monday 6:30am UTC (30 min after the tagger sync, to avoid
    // two simultaneous Scryfall fetches).
    new events.Rule(this, 'WeeklySpellChromaIndex', {
      schedule: events.Schedule.cron({ minute: '30', hour: '6', weekDay: 'MON' }),
      targets: [new targets.LambdaFunction(spellChromaFn)],
    });

    // Commander Spellbook combo index — trims the ~635MB variants bulk export
    // into 32 per-color-identity closure files (each identity file contains all
    // subset-identity combos too). Replaces the top-100-only EDHREC color-page
    // combo detection with the full combo catalog.
    const spellbookCombosFn = new nodejs.NodejsFunction(this, 'SpellbookCombosHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'spellbook-combos.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(10), // measured locally: ~2 min end-to-end
      memorySize: 2048,                  // ~1 vCPU; measured peak RSS ~925MB (106k variants held for bucketing)
      environment: {
        BUCKET_NAME: bucket.bucketName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    bucket.grantReadWrite(spellbookCombosFn);

    // Weekly cron — Monday 7:00am UTC (after the two Scryfall jobs; different
    // upstream, staggered anyway so one failure alarm window is legible).
    new events.Rule(this, 'WeeklySpellbookCombos', {
      schedule: events.Schedule.cron({ minute: '0', hour: '7', weekDay: 'MON' }),
      targets: [new targets.LambdaFunction(spellbookCombosFn)],
    });

    // Outputs
    new cdk.CfnOutput(this, 'TaggerBucketUrl', {
      value: `https://${bucket.bucketName}.s3.amazonaws.com/tagger-tags.json`,
      description: 'Public URL for tagger tags JSON — set this as VITE_TAG_REPO_URL',
    });

    new cdk.CfnOutput(this, 'TaggerSyncFunctionName', {
      value: syncFn.functionName,
      description: 'Lambda function name — invoke manually to seed initial data',
    });

    new cdk.CfnOutput(this, 'SpellChromaIndexUrl', {
      value: `https://${bucket.bucketName}.s3.amazonaws.com/spellchroma-tag-index.json`,
      description: 'Public URL for the SpellChroma tag index — set as VITE_SPELLCHROMA_INDEX_URL',
    });
    new cdk.CfnOutput(this, 'SpellChromaDictUrl', {
      value: `https://${bucket.bucketName}.s3.amazonaws.com/spellchroma-tag-dictionary.json`,
      description: 'Public URL for the SpellChroma tag dictionary — set as VITE_SPELLCHROMA_DICT_URL',
    });
    new cdk.CfnOutput(this, 'SpellChromaIndexFunctionName', {
      value: spellChromaFn.functionName,
      description: 'Lambda function name — invoke manually to seed initial data',
    });

    new cdk.CfnOutput(this, 'SpellbookCombosBaseUrl', {
      value: `https://${bucket.bucketName}.s3.amazonaws.com/spellbook-combos`,
      description: 'Base URL for per-identity Spellbook combo files — set as VITE_SPELLBOOK_COMBOS_URL',
    });
    new cdk.CfnOutput(this, 'SpellbookCombosFunctionName', {
      value: spellbookCombosFn.functionName,
      description: 'Lambda function name — invoke manually to seed initial data',
    });
  }
}
