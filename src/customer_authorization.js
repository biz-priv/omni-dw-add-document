const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB({ apiVersion: "2012-08-10" });
const { dynamo_query } = require("./shared/dynamo");





module.exports.handler = async (event, context) => {
  console.log("Event",event)
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

  const isIvia = customerId === process.env.IVIA_CUSTOMERID;

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
    console.log("entitlementParams",entitlementParams)
    let entitlementResult;
    try {
      entitlementResult = await dynamo.scan(entitlementParams).promise();
      console.log("entitlementResult",entitlementResult)
    } catch (err) {
      console.log("Error", err);
      return { statusCode: 402, body: 'Housebill not found' };
    }
    console.log(entitlementResult.Items[0])
    console.log(!entitlementResult.Items[0])
    if (!entitlementResult.Items[0]) {
      return { statusCode: 403, body: 'Housebill is incorrect' };
    }
  }
  console.log( { statusCode: 200, body: 'Authorized' });
  await fetchFkOrderNumberByHousebillNumber(housebill)
};





async function fetchFkOrderNumberByHousebillNumber(housebill) {
  // const housebill= '6008067'
  const params = {
      // TableName: process.env.PKORDERNO_TABLE,
      // IndexName: process.env.PKORDERNO_TABLE_INDEX,
      TableName: 'omni-wt-rt-shipment-header-dev',
      IndexName: 'Housebill-index',
      KeyConditionExpression: 'Housebill = :housebill',
      ExpressionAttributeValues: {
          ':housebill': { S: housebill }
        },
      ProjectionExpression: 'PK_OrderNo'
  };
  console.log("params",params)
  try {
    const data = await dynamo.query(params).promise();
    console.log("data",data.Items[0].PK_OrderNo.S)
    let PK_OrderNo = data.Items[0].PK_OrderNo.S;
    console.log("PK_OrderNo",PK_OrderNo)
    await validateAddressMapping(PK_OrderNo);
  } catch (err) {
    console.error('Error fetching data from DynamoDB', err);
    throw err;
  }
}





async function validateAddressMapping(PK_OrderNo) {
  try {

    // query the omni-wt-address-mapping-dev table
    const params = {
      TableName: 'omni-wt-address-mapping-dev',
      KeyConditionExpression: 'FK_OrderNo = :o',
      ExpressionAttributeValues: {
          ':o': { S: PK_OrderNo }
        },
    };
    const data = await dynamo.query(params).promise();
    console.log("data.Items.length",data.Items.length)
    // check if the cc_con_zip and cc_con_address values are valid
    if (data.Items.length > 0) {
      const item = data.Items[0];
      console.log("item",item)
      console.log(item.cc_con_zip)
      console.log(item.cc_con_address)
      if (item.cc_con_zip.S == 1 && item.cc_con_address.S == 1) {
        console.log('cc_con_zip:', item.cc_con_zip);
        console.log('cc_con_address:', item.cc_con_address);
        
      } else {
        console.error('Invalid cc_con_zip or cc_con_address in omni-wt-address-mapping-dev table:', item);
        
      }
    } else {
      console.error('No record found in omni-wt-address-mapping-dev table for FK_OrderNo:', PK_OrderNo);
    }
  } catch (err) {
    console.error('Error fetching address mapping from omni-wt-address-mapping-dev table:', err);
    throw err;
  }
} 