const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB({ apiVersion: "2012-08-10" });


const INTERNALERRORMESSAGE = "Internal Error.";

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



module.exports = {dynamo_query}