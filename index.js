const path = require('path')
const fs = require('fs')
const dotenv = require('dotenv')
const handlebars = require('handlebars');
dotenv.config();
const cors = require('cors')
const { exec } = require('child_process');
const express = require('express')
const https = require('https');
const ExcelJS = require('exceljs');
const puppeteer = require('puppeteer');
const moment = require('moment');
const textToSpeech1 = require('@google-cloud/text-to-speech');
const util = require('util');
const client = new textToSpeech1.TextToSpeechClient();
const connectToDatabase = require("./database/db.connection");
const ratingSurveyAudios = require('./models/ratingSurveyAudios');
const chatConvo = require('./models/chatConvo');
const Admin = require('./models/Admin');

const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());
app.use(cors());
connectToDatabase();
const port = 5000;

app.get("/", (req, res) => {
    res.send("Hello World!");
});

const execCommand = (command) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) reject(error);
            resolve(stdout);
        });
    });
};

const lipSyncMessage = async (message) => {
    const time = new Date().getTime();
    console.log(`Starting conversion for message ${message}`);
    await execCommand(
        `ffmpeg -y -i messages/${message}.mp3 messages/${message}.wav`
    );
    console.log(`Conversion done in ${new Date().getTime() - time}ms`);
    await execCommand(
        `rhubarb -f json -o messages/${message}.json messages/${message}.wav -r phonetic`
    );
    console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
};

app.post('/chat', async (req, res) => {
    try {
        const { message, surveyQns, avatar } = req.body

        if (surveyQns !== 0 && surveyQns !== 'download') {
            const getSurveyQnData = await ratingSurveyAudios.findOne({
                avatar,
                audioId: Number(surveyQns)
            })
            const staticSurveyQn = [
                {
                    text: getSurveyQnData.text,
                    audio: getSurveyQnData.audio,
                    lipsync: getSurveyQnData.lipsync,
                    facialExpression: 'smile',
                    animation: 'Idle'
                }
            ]
            console.log('static survey qns being responded!')
            return res.send({ status: 1, messages: staticSurveyQn });
        }

        let messages = [
            {
                text: message,
                audio: '',
                lipsync: { mouthCues: '' },
                facialExpression: 'smile',
                animation: 'Idle'
            }
        ];
        const timestamp = Date.now().toString();
        const randomNum = Math.floor(Math.random() * 1000);

        const generatedUniqueId = `message_audio_${timestamp + randomNum}`

        const fileName = `messages/${generatedUniqueId}.mp3`;
        const filePath = 'monitor-api-usage.json';

        fs.readFile(filePath, 'utf8', async (err, data) => {

            if (err) {
                console.error('Error reading file:', err);
                return res.json({ status: 0, message: err });
            }

            let jsonData = JSON.parse(data);

            console.log('used-characters:', jsonData.usedCharacters, '|', 'req-characters:', messages[0].text.length);

            jsonData.usedCharacters = jsonData.usedCharacters + messages[0].text.length;

            if (jsonData.usedCharacters >= 1000000) {

                console.error('Cannot write file as its reached the limit');

                return res.json({ status: 0, message: 'Google API reached its limit.' });

            } else {

                let updatedJsonData = JSON.stringify(jsonData, null, 2);

                fs.writeFile(filePath, updatedJsonData, 'utf8', async (err) => {
                    if (err) {
                        console.error('Error writing file:', err);
                        return res.json({ status: 0, message: err });
                    }
                    console.log('Characters usage updated successfully->.');
                    await synthesizeTextToSpeech(messages[0].text, fileName, avatar);
                    await lipSyncMessage(generatedUniqueId);
                    messages[0].audio = await audioFileToBase64(fileName);
                    const lipsyncData = await readJsonTranscript(`messages/${generatedUniqueId}.json`)
                    messages[0].lipsync.mouthCues = lipsyncData.mouthCues;
                    // await addNewStaticSurveyQn(messages);
                    return res.send({ status: 1, messages });
                });
            }
        });
    } catch (error) {
        console.error('chatError:', error)
    }
})



async function addNewStaticSurveyQn(messages) {
    try {
        const newRatingSurvey = new ratingSurveyAudios({
            avatar: 'avatar-one',
            text: messages[0].text,
            audio: messages[0].audio,
            lipsync: messages[0].lipsync,
            facialExpression: messages[0].facialExpression,
            animation: messages[0].animation
        })

        const savedData = await newRatingSurvey.save();
        console.log('Message saved successfully');
    } catch (error) {
        console.log('error:', error)
    }
}

function removePunctuation(text) {
    return text.replace(/[,\/#!$%\^&\*;:{}=\-`~()]/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();;
}

const getAvatarVoice = (avatar) => {
    const voiceMap = {
        'avatar-one': 'en-US-Standard-J',
        'avatar-two': 'en-US-Standard-H',
        'avatar-three': 'en-US-Standard-C',
        'avatar-four': 'en-US-Standard-A',
        'avatar-five': 'en-US-Standard-E',
        'avatar-six': 'en-US-Standard-D'
    };
    return voiceMap[avatar];
};

const getAvatarPitch = (avatar) => {
    const pitchMap = {
        'avatar-one': 10.80,
        'avatar-two': 0,
        'avatar-three': 8.80,
        'avatar-four': 5.20,
        'avatar-five': -2.80,
        'avatar-six': 0
    };
    return pitchMap[avatar];
};

async function synthesizeTextToSpeech(text, outputFile, avatar) {
    try {
        const checkFor = "Below are the clinicians available for consultation"
        const checkFor2 = "but below are the available services based on the provided service type."

        if (text.includes(checkFor) || text.includes(checkFor2)) {
            if (text.includes(checkFor2)) {
                text = text.split('type.')[0] + 'type. ' + 'Are you satisfied with our service.'
            } else {
                text = text.split('consultation')[0] + 'consultation. ' + 'Are you satisfied with our service.'
            }
            console.log('text:', text);
        }

        const avatarVoice = getAvatarVoice(avatar);
        const avatarPitch = getAvatarPitch(avatar);

        const request = {
            input: { text: removePunctuation(text) + '.' },
            voice: {
                languageCode: 'en-US',
                name: avatarVoice,
            },
            audioConfig: {
                audioEncoding: 'MP3',
                pitch: avatarPitch,
                speakingRate: 1
            },
        };

        const [response] = await client.synthesizeSpeech(request);
        const writeFile = util.promisify(fs.writeFile);
        await writeFile(outputFile, response.audioContent, 'binary');
        console.log(`Audio content written to file: ${outputFile}`);
    } catch (error) {
        console.error('Error synthesizing text to speech:', error.message);
    }
}

app.post('/generateChatPdf', async (req, res) => {
    try {
        const { data, serviceName } = req.body;
        const chatData = JSON.parse(data);

        handlebars.registerHelper('ifEquals', function (arg1, arg2, options) {
            return (arg1 == arg2) ? options.fn(this) : options.inverse(this);
        });

        handlebars.registerHelper('ifEndsWithColon', function (text, options) {
            if (text.trim().endsWith(':')) {
                return options.fn(this);
            } else {
                return options.inverse(this);
            }
        });

        const chatTemplatePath = path.resolve(__dirname, '.', 'pdfTemp', 'chatTemplate.hbs');
        const chatTemplate = handlebars.compile(fs.readFileSync(chatTemplatePath, 'utf8'));

        const summaryDate = moment().format('DD/MM/YYYY');
        const chatHeading = `${serviceName} Summary - ${summaryDate}`;
        const imagePath = './pdfTemp/rainbowhealthfinder-header-logo.png';
        const imageData = fs.readFileSync(imagePath);
        const base64Image = Buffer.from(imageData, 'binary').toString('base64');

        const htmlContent = chatTemplate({
            chatData,
            serviceName,
            summaryDate,
            chatHeading,
            base64Image
        });

        const browser = await puppeteer.launch();
        const page = await browser.newPage();

        await page.setViewport({ width: 800, height: 600 });
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '40px',
                right: '40px',
                bottom: '40px',
                left: '40px',
            },
        });

        await browser.close();

        res.setHeader('Content-Disposition', `attachment; filename=chatsummary-(${summaryDate}).pdf`);
        res.setHeader('Content-Type', 'application/pdf');
        return res.status(200).json({
            message: "Pdf Created Successfully",
            pdfLocation: pdfBuffer,
            pdfName: `chatsummary-(${summaryDate}).pdf`
        });
    } catch (error) {
        console.error('PDF Generation Error:', error);
        res.status(500).send('Internal server error');
    }
});

app.post('/save-chat', async (req, res) => {
    try {
        const {
            senderId,
            avatarsName,
            sessQn,
            ans
        } = req.body;

        const key = Object.keys(sessQn);

        const updateObj = {
            [key[0]]: ans,
            avatarsName,
            date: moment().format('YYYY-MM-DD')
        };

        const updatedDocument = await chatConvo.findOneAndUpdate(
            { senderId: senderId },
            { $set: updateObj },
            { new: true, upsert: true }
        );

        return res.status(201).json({ message: 'chat saved successfully!', status: 1, updatedDocument })

    } catch (error) {
        console.log('error:', error);
        return res.status(500).json({ message: 'Error saving chat conversation!', status: 0 })
    }
})

app.get('/get-user-data', async (req, res) => {
    try {

        const getUserData = await chatConvo.find();

        // Common Gender Filtration
        const mostCommonGender = getUserData
            .reduce((counts, entry) => {
                const { gender } = entry;
                if (gender) {
                    counts[gender] = (counts[gender] || 0) + 1;
                }
                return counts;
            }, {});

        const [mostCommon, count] = Object
            .entries(mostCommonGender)
            .reduce((prev, current) => {
                return current[1] > prev[1] ? current : prev;
            }, ['', 0]);
        //------------------------------------------------------

        // Common Avatar Filtration
        const mostCommonAvatar = getUserData
            .reduce((counts, entry) => {
                const { avatarsName } = entry;
                if (avatarsName) {
                    counts[avatarsName] = (counts[avatarsName] || 0) + 1;
                }
                return counts;
            }, {});

        const [mostCommonAvatarName, countAvatar] = Object
            .entries(mostCommonAvatar)
            .reduce((prev, current) => {
                return current[1] > prev[1] ? current : prev;
            }, ['', 0]);
        //------------------------------------------------------

        // Common Service Filtration
        const mostCommonService = getUserData
            .reduce((counts, entry) => {
                const { serviceType } = entry;
                if (serviceType) {
                    counts[serviceType] = (counts[serviceType] || 0) + 1;
                }
                return counts;
            }, {});

        const [mostCommonServiceUsed, countService] = Object
            .entries(mostCommonService)
            .reduce((prev, current) => {
                return current[1] > prev[1] ? current : prev;
            }, ['', 0]);
        //------------------------------------------------------

        return res.status(201).json({
            message: 'data received!',
            mostCommonGender: mostCommon,
            mostGenderCount: count,
            mostCommonAvatarName,
            mostCommonServiceUsed,
            countService,
            mostAvatarCount: countAvatar,
            userData: getUserData
        })
    } catch (error) {
        console.error('get-user-data:', error)
    }
})

app.post('/download-report-excel', async (req, res) => {
    const { data } = req.body;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Data');

    worksheet.columns = Object.keys(data[0]).map(key => ({
        header: key,
        key: key,
        width: 20,
        style: {
            font: { bold: true, color: { argb: 'FFFFFFFF' } },
            alignment: { horizontal: 'center', wrapText: true },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: '' } }
        }
    }));

    data.forEach(item => {
        worksheet.addRow(item);
    });

    worksheet.eachRow((row, rowNumber) => {
        row.eachCell((cell, colNumber) => {
            cell.style = {
                border: {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                },
                alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }
            };
            if (rowNumber === 1) {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'dfbcff' }
                };
            } else {
                if (rowNumber % 2 === 0) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFFFFF' }
                    };
                } else {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFD3D3D3' }
                    };
                }
            }
        });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Disposition', 'attachment; filename="data.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
});

app.post('/admin-login', async (req, res) => {
    const { userName, password } = req.body;

    try {
        if (!userName || !password) {
            return res.status(200).json({ status: 0, message: "Please Enter all fields!" });
        }

        const admin = await Admin.findOne({ userName });

        if (!admin) {
            return res.status(200).json({ status: 0, message: "User does not exist" });
        }

        const checkPassword = password === admin.password

        if (!checkPassword) {
            return res.status(200).json({ status: 0, message: "Invalid Credentials!" });
        }

        return res.status(200).json({ message: "Logged in successfully", status: 1 });

    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "Internal error", status: 0, error: error });
    }
});

const readJsonTranscript = async (file) => {
    try {
        const data = await fs.promises.readFile(file, "utf8");
        if (file.includes('messages')) {
            const getWavFile = file.split('.')[0]
            const unlinkFile = `${getWavFile}.wav`
            await fs.promises.unlink(unlinkFile);
            await fs.promises.unlink(file, (err) => {
                if (err) {
                    console.error('Error removing file:', err);
                    return;
                }
                console.log('json removed successfully');
            });
        }
        return JSON.parse(data);
    } catch (error) {
        console.log('Error reading JSON file:', error);
        throw error;
    }
};

const audioFileToBase64 = (file) => {
    try {
        return new Promise((resolve, reject) => {
            fs.readFile(file, async (error, data) => {
                if (error) {
                    console.log('Error reading file:', error);
                    reject(error);
                } else {
                    const base64Data = data.toString('base64');
                    if (file.includes('messages')) {
                        await fs.promises.unlink(file, (err) => {
                            if (err) {
                                console.error('Error removing file:', err);
                                return;
                            }
                            console.log('Mp3 removed successfully');
                        });
                    }
                    resolve(base64Data);
                }
            });
        });
    } catch (error) {
        console.log('audioFileToBase64:', error);
    }
};

// <------------------------------------ FOR PRODUCTION ------------------------------------>
// const sslCert = {
//     key: fs.readFileSync('/etc/letsencrypt/live/avatar.rainbowhealthfinder.com.au/privkey.pem'),
//     cert: fs.readFileSync('/etc/letsencrypt/live/avatar.rainbowhealthfinder.com.au/fullchain.pem')
// }

// https.createServer(sslCert, app).listen(port, () => {
//     console.log(`Rainbow Health Finder app listening on port ${port}`);
// })
// <------------------------------------ FOR PRODUCTION ------------------------------------>



// <------------------------------------ FOR LOCAL ------------------------------------>
app.listen(port, () => {
    console.log(`Rainbow listening on port ${port}`);
});
// <------------------------------------ FOR LOCAL ------------------------------------>
