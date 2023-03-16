const AWS = require('aws-sdk');
const Joi = require('joi');
const dynamo = new AWS.DynamoDB({ apiVersion: "2012-08-10", region: 'us-east-1' });
const axios = require("axios");
const { create, convert } = require('xmlbuilder2');
const Base64 = require("js-base64");

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

module.exports.handler = async (event, PK_OrderNo) => {
    console.log("Event", event)
    const payload = event.body;
    const data = payload.documentUploadRequest
    console.log(data.housebill)
    const housebill = data.housebill
    console.log("housebill", housebill)


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
    console.log("customer_id", customer_id)

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


    const PkOrderNumber = await fetchPkOrderNumberByHousebillNumber(data);
    console.log("PK_OrderNo", PkOrderNumber)
    if(PkOrderNumber.status===403){
        return PkOrderNumber
    }

    // Validate address mapping
    const validationResult = await validateAddressMapping(PkOrderNumber, data);
    // console.log("validationResult", validationResult);
    if (validationResult.status === 403) {
        return validationResult;
    }
    if (validationResult.httpStatus===400){
        return JSON.stringify(validationResult);
    }


    const axiosApi = await apiToPushObjectToWt(validationResult)
    console.log("axiosApi", axiosApi)

    const statusCode = axiosApi.status;
    const message = axiosApi.statusText;

    const responseBody = await response(statusCode, message);

    console.log('Response body:', responseBody);
        

    if (responseBody.httpStatus === 200) {
        return {
            "documentUploadResponse": {
                "message": "success"
            }
        }
        
    }

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
        return PK_OrderNo;

        // console.log(result)
        // return result;
        // console.log("data",data)

    } catch (err) {
        console.error('Error fetching data from DynamoDB', err);
         return {status:403 , body:'Housebill is incorrect'};
    }
}

function pad2(n) {
    return n < 10 ? "0" + n : n;
  }

async function validateAddressMapping(PkOrderNumber, data) {
    try {
        console.log("PkOrderNumber", PkOrderNumber)
        // query the omni-wt-address-mapping-dev table
        const params = {
            TableName: process.env.ADDRESS_MAPPING_TABLE,
            KeyConditionExpression: 'FK_OrderNo = :o',
            ExpressionAttributeValues: {
                ':o': { S: PkOrderNumber }
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
                const result3 = await makeJsonToXml(data);
                // console.log("result3", result3)
                return result3;
            } else {
                console.error('Invalid cc_con_zip or cc_con_address in omni-wt-address-mapping-dev table:', item);
                return { status: 403, body: 'Invalid reference number' };

            }
        } else {
            console.error('No record found in omni-wt-address-mapping-dev table for FK_OrderNo:', PkOrderNumber);
            return { status: 403, body: 'Invalid reference number' };;

        }
    } catch (err) {
        console.error('Error fetching address mapping from omni-wt-address-mapping-dev table:', err);
        return{ status: 403, body: 'Invalid' }
    }
}




async function makeJsonToXml(data) {
    console.log("data", data)
    const date = new Date();
    let fileExtension="";
     if (data.b64str.length < 3000000) {
        let pattern =
          /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/;
        const Base64 = data.b64str.match(pattern)
          ? "Base64"
          : "Not Base64";
        if (Base64 != "Base64") {
          return (
            response(
              400,
              "Please ensure b64str field is a valid base64 string."
            )
          );
        }
      } else if (!Base64.isValid(data.b64str)) {
        return (
          response(400, "Please ensure b64str field is a valid base64 string.")
        );
      }
      if (
        "contentType" in data &&
        data.contentType.split("/").length >= 2 &&
        data.contentType.split("/")[1] != "" &&
        data.contentType.includes("/pdf"||"/gif"||"/jpeg"||"/png")
      ) {
        fileExtension =
          "." + data.contentType.split("/")[1];
      } else {
        if (data.b64str.startsWith("/9j/4")) {
          fileExtension = ".jpeg";
        } else if (data.b64str.startsWith("iVBOR")) {
          fileExtension = ".png";
        } else if (data.b64str.startsWith("R0lG")) {
          fileExtension = ".gif";
        } else if (data.b64str.startsWith("J")) {
          fileExtension = ".pdf";
        } else if (
          data.b64str.startsWith("TU0AK") ||
          data.b64str.startsWith("SUkqA")
        ) {
          fileExtension = ".tiff";
        } else {
          fileExtension = "";
        }
      }
      if (fileExtension == "") {
        return (
          response(
            400,
            "Unable to identify filetype. Please send content type with file extension."
          )
        );
      }
     console.log(data.contentType.split("/")[1])
     console.log(data.contentType.split("/").length)
      let formatDate =
        date.getFullYear().toString() +
        pad2(date.getMonth() + 1) +
        pad2(date.getDate()) +
        pad2(date.getHours()) +
        pad2(date.getMinutes()) +
        pad2(date.getSeconds());
    let fileName=data.housebill + '_' + data.docType + '_' + formatDate + fileExtension
    console.log("fileName",fileName)
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
                    Filename: fileName,
                    DocType: data.docType,
                    FileDataBase64: data.b64str
                }
            }
        }
    });
    
    // console.info("xml payload", xml);
    return xml;

}


async function apiToPushObjectToWt(validationResult) {
    const config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: process.env.UPLOAD_DOCUMENT_API,
        headers: {
            "content-type": "text/xml",
        },
        data: validationResult,
    }
    console.log("config", config)
    try {
        const axiosResponse = await axios(config);

        console.log('response', axiosResponse);
        return axiosResponse;

        
    } catch (error) {
        console.log('Error in API request:', error);
    }

}


async function response(statusCode, message) {
    const responseObj = {
        httpStatus: statusCode,
        message,
    };

    return responseObj;
}