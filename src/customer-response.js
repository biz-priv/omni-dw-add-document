const AWS = require('aws-sdk');
const Joi = require('joi');

exports.handler = async (event) => {
    const payload = event.body;
    console.log(event)
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

    const { error } = schema.validate(payload);
    if (error) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                message: error.details[0].message
            })
        };
    }
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Success'
        })
    };
}; 