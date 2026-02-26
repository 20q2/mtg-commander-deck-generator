#!/usr/bin/env node
import 'source-map-support/register';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../.env.local') });
import * as cdk from 'aws-cdk-lib';
import { AnalyticsStack } from '../lib/analytics-stack';
import { TaggerStack } from '../lib/tagger-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

new AnalyticsStack(app, 'MtgDeckBuilderAnalytics', { env });
new TaggerStack(app, 'MtgDeckBuilderTagger', { env });
