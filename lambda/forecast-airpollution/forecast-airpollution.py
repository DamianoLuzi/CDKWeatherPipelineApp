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
        geo_url = f"http://api.openweathermap.org/geo/1.0/direct?q={urllib.parse.quote(city)}&limit=1&appid={api_key}"
        with urllib.request.urlopen(geo_url) as response:
            geo = json.loads(response.read().decode())[0]
        lat, lon = geo['lat'], geo['lon']
        url = f"http://api.openweathermap.org/data/2.5/air_pollution/forecast?lat={lat}&lon={lon}&appid={api_key}"
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode())
        key = f"airpollution/forecast/{city}-{datetime.utcnow().isoformat()}.json"
        s3.put_object(Bucket=os.environ["S3OWBucket"], Key=key, Body=json.dumps(data), ContentType='application/json')
    return {'statusCode': 200, 'body': json.dumps({"message": "Air pollution (forecast) stored", "cities": cities})}
