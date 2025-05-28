// app.js
require('dotenv').config(); // Carrega as variáveis de ambiente do .env

const express = require('express');
const bodyParser = require('body-parser');
const { google } = require('googleapis'); // Importa a biblioteca do Google APIs
const axios = require('axios'); // Para fazer chamadas HTTP, se necessário

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- Credenciais do Google Calendar (VÃO PARA VARIÁVEIS DE AMBIENTE!) ---
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI; // Ex: 'http://localhost:3000/oauth2callback' ou 'https://your-heroku-app.herokuapp.com/oauth2callback'

// OAuth2Client para autenticação
const oAuth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
);

// Armazenar os tokens (PARA UM PROJETO DE FACULDADE, você pode armazenar em memória
// depois de obter os tokens uma vez, ou usar um arquivo simples/env vars).
// Em produção, isso viria de um banco de dados associado a um usuário.
let userTokens = null;

// --- Rota para o Webhook do n8n ---
app.post('/webhook', async (req, res) => {
    // req.body virá do n8n. O formato vai depender de como você configura o n8n.
    // Exemplo comum:
    const incomingMessage = req.body.message;
    const senderId = req.body.senderId; // ID do remetente do WhatsApp

    console.log(`Mensagem recebida de ${senderId}: ${incomingMessage}`);

    let replyText = "Olá! Posso ajudar a agendar um evento.";

    // --- Lógica do Chatbot ---
    if (!userTokens) {
        // Se ainda não houver tokens, instrua o usuário a autenticar (apenas para teste inicial)
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/calendar.events'], // Escopo que você escolheu
        });
        replyText = `Preciso de autorização para acessar sua agenda. Por favor, visite este link uma única vez para autorizar (copie e cole no navegador):\n${authUrl}\nDepois de autorizar, por favor, me diga 'agendar evento'.`;
        console.log(`URL de autenticação gerada: ${authUrl}`);
        // Você pode querer armazenar o senderId para associar os tokens mais tarde em um cenário real.
        // Para um projeto simples, a autenticação pode ser feita manualmente por você.
    } else if (incomingMessage.toLowerCase().includes('agendar evento')) {
        replyText = "Certo! Qual o título do evento, a data (AAAA-MM-DD) e a hora (HH:MM)? (Ex: Reunião 2025-12-25 10:00)";
        // Em um chatbot mais complexo, você armazenaria o estado da conversa aqui
    } else if (incomingMessage.match(/^(.+?) (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/)) {
        // Regex para extrair Título, Data e Hora
        const match = incomingMessage.match(/^(.+?) (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/);
        const title = match[1];
        const date = match[2];
        const time = match[3];

        try {
            oAuth2Client.setCredentials(userTokens); // Define as credenciais (que podem ser atualizadas pelo refresh token)
            await scheduleEvent(title, date, time);
            replyText = `Evento "${title}" em ${date} às ${time} foi agendado com sucesso!`;
        } catch (error) {
            console.error("Erro ao agendar evento:", error.message);
            if (error.message.includes('No refresh token is set')) {
                replyText = "O token de acesso expirou e não tenho um refresh token. Por favor, reautentique clicando no link anterior e me diga 'agendar evento' novamente.";
                userTokens = null; // Limpa os tokens para forçar reautenticação
            } else {
                replyText = "Desculpe, não consegui agendar o evento. Verifique o formato ou tente novamente mais tarde.";
            }
        }
    } else {
        replyText = "Não entendi. Para agendar, diga 'agendar evento'.";
    }
    // --- Fim da Lógica do Chatbot ---

    // Retorna a resposta para o n8n. O n8n será responsável por enviar para o WhatsApp.
    res.json({ reply: replyText, senderId: senderId });
});

// --- Rota de Callback para OAuth2 ---
// Esta rota receberá o 'code' do Google após a autorização do usuário.
app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
        return res.status(400).send('No authorization code provided.');
    }

    try {
        const { tokens } = await oAuth2Client.getToken(code);
        userTokens = tokens; // Armazena os tokens globalmente para este exemplo
        console.log('Tokens obtidos e armazenados:', userTokens);

        // **IMPORTANTE:** Em um projeto real, você armazenaria esses tokens em um banco de dados
        // associados a um usuário, e não em uma variável global ou no código.
        // Para o seu projeto de faculdade, você pode imprimir isso e depois definir
        // o GOOGLE_REFRESH_TOKEN e GOOGLE_ACCESS_TOKEN (opcional, refresh token é o mais importante)
        // como variáveis de ambiente no Heroku.

        res.send('Autenticação com Google Calendar bem-sucedida! Agora você pode voltar ao WhatsApp e continuar a conversa.');
    } catch (error) {
        console.error('Erro ao obter tokens:', error.message);
        res.status(500).send('Falha na autenticação com Google Calendar. Tente novamente.');
    }
});

// --- Função para Agendar Evento no Google Calendar ---
async function scheduleEvent(title, date, time) {
    if (!oAuth2Client.credentials.access_token && !oAuth2Client.credentials.refresh_token) {
        throw new Error("Google Calendar não autenticado. Por favor, autentique primeiro.");
    }

    // A biblioteca googleapis lida com a renovação do access_token automaticamente se refresh_token estiver presente.
    // Você só precisa se certificar que oAuth2Client.setCredentials(userTokens) foi chamado.

    const dateTimeStart = new Date(`${date}T${time}:00`);
    const dateTimeEnd = new Date(dateTimeStart.getTime() + 60 * 60 * 1000); // Duração de 1 hora

    const event = {
        summary: title,
        description: `Agendado via chatbot WhatsApp`,
        start: {
            dateTime: dateTimeStart.toISOString(),
            timeZone: 'America/Sao_Paulo', // Ajuste para o fuso horário correto
        },
        end: {
            dateTime: dateTimeEnd.toISOString(),
            timeZone: 'America/Sao_Paulo',
        },
        reminders: {
            useDefault: false,
            overrides: [
                { method: 'email', minutes: 24 * 60 },
                { method: 'popup', minutes: 10 },
            ],
        },
    };

    try {
        const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
        const res = await calendar.events.insert({
            calendarId: 'primary', // 'primary' refere-se ao calendário padrão do usuário autenticado
            resource: event,
        });
        console.log('Evento criado no Google Calendar:', res.data.htmlLink);
        return res.data;
    } catch (error) {
        console.error('Erro ao criar evento no Google Calendar:', error.message);
        throw error;
    }
}

app.listen(port, () => {
    console.log(`Chatbot server listening at http://localhost:${port}`);
});