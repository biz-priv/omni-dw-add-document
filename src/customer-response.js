const AWS = require('aws-sdk');
const Joi = require('joi');
const dynamo = new AWS.DynamoDB({ apiVersion: "2012-08-10", region: 'us-east-1' });
const axios = require("axios");
const { create, convert } = require('xmlbuilder2');

const schema = Joi.object({
    documentUploadRequest: Joi.object({
        housebill: Joi.number().integer(),
        fileNumber: Joi.number().integer(),
        contentType: Joi.any().required(),
        docType: Joi.string().valid(
            "CERTIFICAT",
            "CONSULAR",
            "CUST RATE",
            "CUSTOMS",
            "DANGEROUS",
            "DCCL",
            "DECON",
            "HCPOD",
            "IBU",
            "IMPORT LIC",
            "INSURANCE",
            "INVOICE",
            "MSDS",
            "OCCL",
            "OMNI RA",
            "ORIG BOL",
            "PACKING",
            "PO",
            "POD",
            "PRO FORMA",
            "RA",
            "SED",
            "SLI",
            "WAYBILL"
        )
            .required(),
        b64str: Joi.string().required()
    }).or("housebill", "fileNumber")
        .required()
}).required();

module.exports.handler = async (event) => {
    console.log("Event",event)
    const payload = event.body;
    const data =payload.documentUploadRequest
    console.log(data.housebill)
    const housebill=data.housebill
    console.log("housebill",housebill)
   
   
    const { error } = schema.validate(payload);
    if (error) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                message: error.details[0].message
            })
        };
    }

    const customer_id = event.enhancedAuthContext.customerId;
    console.log("customer_id",customer_id)

    const isIvia = customer_id === process.env.IVIA_CUSTOMERID;

    // If customerId is not Ivia, check housebill entitlements
    if (!isIvia) {
        const entitlementParams = {
          TableName: process.env.CUSTOMER_ENTITLEMENT_TABLE,
          FilterExpression: 'CustomerID = :customerId and HouseBillNumber = :housebill',
          ExpressionAttributeValues: {
            ':customerId': { S: customer_id },
            ':housebill': { S: housebill }
          }
        };
        console.log("entitlementParams", entitlementParams)
        let entitlementResult;
        try {
          entitlementResult = await dynamo.scan(entitlementParams).promise();
          console.log("entitlementResult", entitlementResult)
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

      await fetchPkOrderNumberByHousebillNumber(data);

    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Success'
        })
    };
}; 


async function fetchPkOrderNumberByHousebillNumber(data) {
    const housebill=data.housebill;
    const params = {
        TableName: process.env.SHIPMENT_HEADER_TABLE,
        IndexName: process.env.SHIPMENT_HEADER_TABLE_INDEX,
        KeyConditionExpression: 'Housebill = :housebill',
        ExpressionAttributeValues: {
            ':housebill': { S: housebill }
        },
        ProjectionExpression: 'PK_OrderNo'
    };
    console.log("params", params)
    try {
        const queryShipmentHeader = await dynamo.query(params).promise();
        console.log("queryShipmentHeader", queryShipmentHeader.Items[0].PK_OrderNo.S)
        let PK_OrderNo = queryShipmentHeader.Items[0].PK_OrderNo.S;
        console.log("PK_OrderNo", PK_OrderNo)
        await validateAddressMapping(PK_OrderNo,data);
        console.log("data",data)
        
    } catch (err) {
        console.error('Error fetching data from DynamoDB', err);
        throw err;
    }
}



async function validateAddressMapping(PK_OrderNo,data) {
    try {

        // query the omni-wt-address-mapping-dev table
        const params = {
            TableName: process.env.ADDRESS_MAPPING_TABLE,
            KeyConditionExpression: 'FK_OrderNo = :o',
            ExpressionAttributeValues: {
                ':o': { S: PK_OrderNo }
            },
        };
        const queryMapping = await dynamo.query(params).promise();
        console.log("data.Items.length", queryMapping.Items.length)
        // check if the cc_con_zip and cc_con_address values are valid
        if (queryMapping.Items.length > 0) {
            const item = queryMapping.Items[0];
            console.log("item", item)
            console.log(item.cc_con_zip)
            console.log(item.cc_con_address)
            if (item.cc_con_zip.S == 1 && item.cc_con_address.S == 1) {
                console.log('cc_con_zip:', item.cc_con_zip);
                console.log('cc_con_address:', item.cc_con_address);
                await makeJsonToXml(data);

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




async function makeJsonToXml(data) {
    console.log("data",data)
    const date = new Date();
    const timestamp = date.toISOString().replace(/[-:]/g, '').slice(0, 14);

    let xml = "";
    xml = convert({
        "soap:Envelope": {
            "@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            "@xmlns:xsd": "http://www.w3.org/2001/XMLSchema",
            "@xmlns:soap": "http://schemas.xmlsoap.org/soap/envelope/",
            "soap:Body": {
                AttachFileToShipment: {
                    "@xmlns": "http://tempuri.org/",
                    Housebill: data.housebill,
                    Filename: data.housebill+'_'+data.docType+'_'+timestamp+'.pdf',
                    DocType: data.docType,
                    FileDataBase64: data.b64str
                }
            }
        }
    });

    console.info("xml payload", xml);
    await apiToPushObjectToWt(xml)

}


async function apiToPushObjectToWt(xml) {
    const config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: process.env.UPLOAD_DOCUMENT_API,
        headers: {
            "content-type": "text/xml",
        },
        data: xml,
    }
    console.log("config", config)
    try {
        const axiosResponse = await axios(config); 

        console.log('response', axiosResponse);

        const statusCode = axiosResponse.status;
        const message = axiosResponse.statusText;

        const responseBody = await response(statusCode, message); 

        console.log('Response body:', responseBody);
    } catch (error) {
        console.log('Error in API request:', error);
    }

}


async function response(statusCode, message) {
    const responseObj = {
        httpStatus: statusCode,
        message,
    };

    return JSON.stringify(responseObj);
}