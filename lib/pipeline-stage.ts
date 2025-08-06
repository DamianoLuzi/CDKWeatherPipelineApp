import { Stage,StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CdkOWStack } from "./cdk-weather-pipeline-stack";

export class PipelineStage extends Stage {
    constructor(scope: Construct, id: string, props?: StageProps) {
        super(scope, id, props);

        const app = new CdkOWStack(this, 'CdkOWStack')
    }
}