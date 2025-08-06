import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import {
  aws_lambda as lambda,
  aws_iam as iam,
  aws_s3 as s3,
  aws_events as events,
  aws_events_targets as targets,
  aws_apigatewayv2 as apigw,
  aws_apigatewayv2_integrations as integrations,
  aws_ssm as ssm,
  CfnOutput,
  Duration
} from 'aws-cdk-lib';
import * as path from 'path';


export class CdkOWStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'CdkWeatherPipelineQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
    //  1. S3 Bucket
    const bucket = new s3.Bucket(this, 'S3BucketOpenWeather', {
      bucketName: 's3-open-weather-data-us-east-1',
      encryption: s3.BucketEncryption.S3_MANAGED,
      publicReadAccess: false,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev/test purposes
    });

    // 2. IAM Role for Lambda
    const lambdaRole = new iam.Role(this, 'OpenWeatherLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      roleName: 'ow-lambda-role',
      inlinePolicies: {
        LambdaPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['logs:*'],
              resources: ['arn:aws:logs:*:*:*'],
              effect: iam.Effect.ALLOW,
            }),
            new iam.PolicyStatement({
              actions: ['s3:PutObject'],
              resources: [`${bucket.bucketArn}/*`],
              effect: iam.Effect.ALLOW,
            }),
            new iam.PolicyStatement({
              actions: ['ssm:GetParameter'],
              resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/OWAPIkey`],
              effect: iam.Effect.ALLOW,
            }),
          ]
        })
      }
    });

    // 3. Lambda Function Factory
    const makeLambda = (id: string, filename: string, timeoutSec: number) => {
      return new lambda.Function(this, id, {
        runtime: lambda.Runtime.PYTHON_3_13,
        handler: `${filename}.lambda_handler`,
        code: lambda.Code.fromAsset(`lambda/${filename}`),
        environment: { S3OWBucket: bucket.bucketName },
        role: lambdaRole,
        timeout: Duration.seconds(timeoutSec),
        architecture: lambda.Architecture.ARM_64,
        functionName: id,
      });
    };

    const currentWeatherFn = makeLambda('CurrentWeather', 'current-weather', 10);
    const forecastWeatherFn = makeLambda('ForecastWeather', 'forecast-weather', 10);
    const pollutionCurrentFn = makeLambda('AirPollutionCurrent', 'current-airpollution', 10);
    const pollutionForecastFn = makeLambda('AirPollutionForecast', 'forecast-airpollution', 10);

    // 4. EventBridge Rule + Role
    const schedulerRole = new iam.Role(this, 'OpenWeatherSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
    });

    [
      currentWeatherFn,
      forecastWeatherFn,
      pollutionCurrentFn,
      pollutionForecastFn
    ].forEach(fn => {
      fn.grantInvoke(schedulerRole);
    });

    const rule = new events.Rule(this, 'ScheduledRule', {
      schedule: events.Schedule.rate(Duration.hours(24))
    });

    rule.addTarget(new targets.LambdaFunction(currentWeatherFn,
      // { retryAttempts: 2, event: events.RuleTargetInput.fromObject({ source: 'scheduler' })}
       ));
    rule.addTarget(new targets.LambdaFunction(forecastWeatherFn));
    rule.addTarget(new targets.LambdaFunction(pollutionCurrentFn));
    rule.addTarget(new targets.LambdaFunction(pollutionForecastFn));

    // 5. API Gateway HTTP API
    const httpApi = new apigw.HttpApi(this, 'OpenWeatherAPI', {
      apiName: 'openweather-api',
      corsPreflight: {
        allowHeaders: ['*'],
        allowMethods: [apigw.CorsHttpMethod.GET],
        allowOrigins: ['*'],
      },
    });

    const addRoute = (path: string, fn: lambda.IFunction) => {
      const integration = new integrations.HttpLambdaIntegration(`${path}Integration`, fn);
      httpApi.addRoutes({
        path,
        methods: [apigw.HttpMethod.GET],
        integration,
      });

      //new lambda.CfnPermission(this, `${path}InvokePermission`, {
      //  action: 'lambda:InvokeFunction',
      //  functionName: fn.functionName,
      //  principal: 'apigateway.amazonaws.com',
      //  sourceArn: arn:aws:execute-api:${this.region}:${this.account}:${httpApi.httpApiId}/*/GET${path},
      //});
      httpApi.addRoutes({
        path,
        methods: [apigw.HttpMethod.GET],
        integration,
      });
    };

    addRoute('/weather/current', currentWeatherFn);
    addRoute('/weather/forecast', forecastWeatherFn);
    addRoute('/airpollution/current', pollutionCurrentFn);
    addRoute('/airpollution/forecast', pollutionForecastFn);

    // 6. Outputs
    new CfnOutput(this, 'S3BucketName', {
      value: bucket.bucketName,
      description: 'S3 bucket name for storing weather data',
    });

    new CfnOutput(this, 'APIEndpoint', {
      value: httpApi.apiEndpoint,
      description: 'API Gateway endpoint',
    });
  }
}
