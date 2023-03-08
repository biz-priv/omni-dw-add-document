const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB({ apiVersion: "2012-08-10" });



const INTERNALERRORMESSAGE = "Internal Error.";

exports.handler = async (event, context) => {
  console.log(event)
  const api_key = event.headers['x-api-key'];
  const housebill = event.query.housebill;
  console.log("apiKey", api_key)
  console.log("housebill", housebill)
  // validate the x-apiKEy from dynamoDB aas
  let response;
  try {
    response = await dynamo_query(
      process.env.TOKEN_VALIDATION_TABLE,
      process.env.TOKEN_VALIDATION_TABLE_INDEX,
      "ApiKey = :apikey",
      { ":apikey": { S: api_key } }
    );
    console.log("response", response)
  } catch (err) {
    console.log(err);
    return { statusCode: 400, body: 'Unauthorized' };
  }
  console.log(response.Items)
  
  console.log(!response.Items[0])
  if (!response.Items[0]) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const customerId = response.Items[0].CustomerID.S;
  console.log("customerId", customerId)

  const isIvia = customerId === '10321412';

  // If customerId is not Ivia, check housebill entitlements
  if (!isIvia) {
    const entitlementParams = {
      TableName: process.env.CUSTOMER_ENTITLEMENT_TABLE,
      FilterExpression: 'CustomerID = :customerId and HouseBillNumber = :housebill',
      ExpressionAttributeValues: {
        ':customerId': { S: customerId },
        ':housebill': { S: housebill }
      }
    };
    console.log(entitlementParams)
    let entitlementResult;
    try {
      entitlementResult = await dynamo.scan(entitlementParams).promise();
      console.log(entitlementResult)
    } catch (err) {
      console.log("Error",err);
      return { statusCode: 402, body: 'Housebill not found' };
    }
    console.log(entitlementResult.Items[0])
    console.log(!entitlementResult.Items[0])
    if (!entitlementResult.Items[0]) {
      return { statusCode: 403, body: 'Housebill is incorrect' };
    }
  }
  return { statusCode: 200, body: 'Authorized' };
};



const dynamo_query = (table_name, index_name, expression, attributes) => {
  return new Promise(async (resolve, reject) => {
    try {
      var params = {
        TableName: table_name,
        IndexName: index_name,
        KeyConditionExpression: expression,
        ExpressionAttributeValues: attributes,
      };

      dynamo.query(params, function (err, data) {
        if (err) {
          console.log("Error:params", err);
          reject(INTERNALERRORMESSAGE);
        } else {
          console.log("Success", data);
          resolve(data);
        }
      });
    } catch (error) {
      console.log("error:getDynamoData", error);
      reject(INTERNALERRORMESSAGE);
    }
  });
};