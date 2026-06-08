import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as iam from 'aws-cdk-lib/aws-iam';

export class SiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Override these via .env.local (already git-ignored) to redeploy this stack
    // to a different domain/repo without editing code.
    const DOMAIN_NAME = process.env.SITE_DOMAIN || 'manafoundry.gg';
    const WWW_DOMAIN = `www.${DOMAIN_NAME}`;
    const GITHUB_OWNER = process.env.GITHUB_OWNER || '20q2';
    const GITHUB_REPO = process.env.GITHUB_REPO || 'mtg-commander-deck-generator';
    const bucketSlug = DOMAIN_NAME.replace(/\./g, '-');

    // Existing hosted zone created when the domain was registered in Route 53.
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: DOMAIN_NAME,
    });

    // Private bucket. CloudFront is the only thing that can read it (via OAC below).
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: `${bucketSlug}-site-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ACM cert. Must live in us-east-1 for CloudFront — this stack already deploys there.
    const certificate = new acm.Certificate(this, 'SiteCertificate', {
      domainName: DOMAIN_NAME,
      subjectAlternativeNames: [WWW_DOMAIN],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      defaultRootObject: 'index.html',
      domainNames: [DOMAIN_NAME, WWW_DOMAIN],
      certificate,
      // SPA fallback so client-side routes survive a hard refresh.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    const cfTarget = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
    new route53.ARecord(this, 'ApexAlias', { zone: hostedZone, recordName: DOMAIN_NAME, target: cfTarget });
    new route53.AaaaRecord(this, 'ApexAliasV6', { zone: hostedZone, recordName: DOMAIN_NAME, target: cfTarget });
    new route53.ARecord(this, 'WwwAlias', { zone: hostedZone, recordName: WWW_DOMAIN, target: cfTarget });
    new route53.AaaaRecord(this, 'WwwAliasV6', { zone: hostedZone, recordName: WWW_DOMAIN, target: cfTarget });

    // GitHub OIDC provider — only one per AWS account is allowed.
    // If `cdk deploy` errors with EntityAlreadyExists, comment this out and replace the
    // `openIdConnectProviderArn` reference below with the existing provider's ARN.
    const githubOidcProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const deployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
      assumedBy: new iam.FederatedPrincipal(
        githubOidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': `repo:${GITHUB_OWNER}/${GITHUB_REPO}:*`,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      description: `Assumed by GitHub Actions (${GITHUB_OWNER}/${GITHUB_REPO}) to deploy the ${DOMAIN_NAME} site`,
    });
    siteBucket.grantReadWrite(deployRole);
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [`arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`],
      }),
    );

    new cdk.CfnOutput(this, 'SiteBucketName', {
      value: siteBucket.bucketName,
      description: 'Set as GitHub repo variable SITE_BUCKET',
    });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'Set as GitHub repo variable CLOUDFRONT_ID',
    });
    new cdk.CfnOutput(this, 'DistributionDomain', {
      value: distribution.distributionDomainName,
      description: 'CloudFront domain — useful for verifying before DNS propagates',
    });
    new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: deployRole.roleArn,
      description: 'Set as GitHub repo variable AWS_DEPLOY_ROLE_ARN',
    });
  }
}
