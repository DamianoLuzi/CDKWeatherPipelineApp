import json, boto3, os, urllib.request, urllib.parse
from datetime import datetime
s3 = boto3.client('s3')
ssm = boto3.client('ssm')
def get_api_key():
    return ssm.get_parameter(Name='OWAPIkey', WithDecryption=True)['Parameter']['Value']
def lambda_handler(event, context):
    qs = event.get("queryStringParameters", {})
    cities = [c.strip() for c in qs.get("cities", "London").split(',')]
    api_key = get_api_key()
    for city in cities:
        url = f"http://api.openweathermap.org/data/2.5/weather?q={urllib.parse.quote(city)}&appid={api_key}&units=metric"
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode())
        key = f"weather/current/{city}-{datetime.utcnow().isoformat()}.json"
        s3.put_object(Bucket=os.environ["S3OWBucket"], Key=key, Body=json.dumps(data), ContentType='application/json')
    return {'statusCode': 200, 'body': json.dumps({"message": "Current weather stored", "cities": cities})}
