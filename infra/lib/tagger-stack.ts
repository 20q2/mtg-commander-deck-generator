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
            'https://20q2.github.io',
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
      timeout: cdk.Duration.minutes(5), // Scryfall pagination can take a while
      memorySize: 256,
      environment: {
        BUCKET_NAME: bucket.bucketName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    bucket.grantWrite(syncFn);

    // Weekly cron — every Monday at 6am UTC
    new events.Rule(this, 'WeeklyTaggerSync', {
      schedule: events.Schedule.cron({ minute: '0', hour: '6', weekDay: 'MON' }),
      targets: [new targets.LambdaFunction(syncFn)],
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
  }
}
