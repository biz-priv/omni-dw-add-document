const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB({ apiVersion: "2012-08-10" });
const { dynamo_query } = require("./shared/dynamo");


const POLICY_ID = "bizCloud|a1b2";
const INTERNALERRORMESSAGE = "Internal Error.";



module.exports.handler = async (event, context, callback) => {
  // validate the x-apiKEy from dynamoDB aas
  try {
    let api_key, params;
    try {
      console.info("Event: ", JSON.stringify(event));
      api_key = event["headers"]["x-api-key"];
    } catch (api_error) {
      console.log("ApiKeyError", api_error);
      return callback(response("400", "API Key not passed."));
    }
    const validation_response = validate_input(event.methodArn);
    if (validation_response["status"] == "error") {
      return callback(
        null,
        generate_policy(
          POLICY_ID,
          "Deny",
          event.methodArn,
          null,
          validation_response.message
        )
      );
    }
    const response = await dynamo_query(
      process.env.TOKEN_VALIDATION_TABLE,
      process.env.TOKEN_VALIDATION_TABLE_INDEX,
      "ApiKey = :apikey",
      { ":apikey": { S: api_key } }
    );
    console.log("response", response)
    console.log(response.Items)

    console.log(!response.Items[0])
    if (!response.Items[0]) {
      return { statusCode: 401, body: 'Unauthorized' };
    }

    
    console.log("customerId", customer_id)
    if (event.methodArn.includes("/customer-response")) {
      return callback(
        null,
        generate_policy(POLICY_ID, "Allow", event.methodArn, customer_id)
      );
    }
  } catch (error) {
    console.log("error:handler", error);
    return callback(response(500, INTERNALERRORMESSAGE));
  }
};


const generate_policy = (
  principal_id,
  effect,
  method_arn,
  customer_id = null,
  message = null
) => {
  try {
    const policy = {};
    policy.principalId = principal_id;
    policy.policyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "ApiAccess",
          Action: "execute-api:Invoke",
          Effect: effect,
          Resource: method_arn,
        },
      ],
    };
    if (message) {
      policy.context = { message };
    } else if (customer_id) {
      policy.context = { customerId: customer_id };
    }
    console.info("Policy:", JSON.stringify(policy));
    return policy;
  } catch (error) {
    throw INTERNALERRORMESSAGE;
  }
};


const validate_input = (method_arn) => {
  if (method_arn.includes("/shipment/addmilestone")) {
    return { status: "success" };
  } else {
    return { status: "success" };
  }
};

const response = (code, message) => {
  return JSON.stringify({
    httpStatus: code,
    message,
  });
};