const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const chatConvoSchema = new Schema({
    senderId: { type: String, required: true },
    avatarsName: { type: String, required: true },
    gender: { type: String },
    birthSex: { type: String },
    sexualOrientation: { type: String },
    serviceType: { type: String },
    populationDetails: { type: String },
    costModel: { type: String },
    shortSummary: { type: String },
    proximitySlot: { type: String },
    accuracyOfTheAdvice: { type: String },
    accuracyOfTheConversation: { type: String },
    healthServicesProvided: { type: String },
    overallExperience: { type: String },
    HowToImprove: { type: String },
    emailAddress: { type: String },
    date: { type: String }
},
    { timestamps: true }
);

module.exports = mongoose.model("chat_convo", chatConvoSchema, "chat_convo");
