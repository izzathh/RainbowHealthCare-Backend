const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ratingSurveySchema = new Schema({
    avatar: {
        type: String,
        required: true
    },
    text: {
        type: String,
        required: true
    },
    audio: {
        type: String,
        default: ''
    },
    lipsync: {
        type: Schema.Types.Mixed,
        default: null
    },
    facialExpression: {
        type: String,
        default: 'smile'
    },
    animation: {
        type: String,
        default: 'Idle'
    },
},
    { timestamps: true }
);

module.exports = mongoose.model("Rating_survey_audios", ratingSurveySchema, "rating_survey_audios");
