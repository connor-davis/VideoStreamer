'use strict';
let dotenv = require('dotenv');
dotenv.config();

let logger = require('./utils/logger');

let express = require('express');
let app = express();
let fs = require('fs');
let path = require('path');
let { v4 } = require('uuid');
let http = require('http').createServer(app);
let devmode = process.env.DEV_MODE === 'true';
let https;

logger.info(`OP MODE: ${devmode ? 'DEV' : 'PROD'}`);

if (!devmode) {
  https = require('https').createServer(
    {
      cert: fs.readFileSync(
        devmode
          ? '/certs/publicKey.pem'
          : process.env.CERTPATH + '/fullchain.pem'
      ),
      key: fs.readFileSync(
        devmode ? '/certs/publicKey.pem' : process.env.CERTPATH + '/privkey.pem'
      ),
    },
    app
  );
}

let compression = require('compression');
let cors = require('cors');
let { json, urlencoded } = require('body-parser');

let session = require('express-session');

let port = process.env.HTTP_PORT || 4000;
let secure_port = process.env.HTTP_SECURE_PORT || 443;

let io = require('socket.io')(http);
let sockets = {};
let videos = [];
let sessions = {};

fs.readdirSync(path.join(__dirname, 'videos')).forEach(
  (videoName, index, array) => {
    let videoId = v4();

    videos.push({
      videoName: videoName.split('.')[0],
      videoId,
      videoPath: path.join(__dirname, 'videos', videoName),
    });
  }
);

io.on('connection', (socket) => {
  logger.info('a user connected to socket io');

  let socketId = v4();

  socket.id = socketId;

  sockets[socketId] = socket;

  let sessionId = v4();

  socket.on('*', function (event, data) {
    console.log(event);
    console.log(data);
  });

  socket.on('newSession', () => {
    socket.emit('newSessionId', { sessionId, videos });
  });

  socket.on('startSession', (packet) => {
    console.log(packet.sessionId + "'s session has started");

    sessions[packet.sessionId] = {
      sessionId: packet.sessionId,
      videoId: packet.videoId,
    };

    io.emit(sessionId, {
      event: 'started-session',
      sessionId: packet.sessionId,
      videoId: packet.videoId,
    });
  });

  socket.on('joinSession', (sessionId) => {
    console.log('A user joined session ' + sessionId);

    let session = sessions[sessionId];

    io.emit(sessionId, {
      event: 'joined-session',
      sessionId: session.sessionId,
      videoId: session.videoId,
    });
  });

  socket.on(sessionId, (packet) => {
    fs.writeFileSync(
      path.join(__dirname, 'logs', sessionId + '.txt'),
      JSON.stringify({ sessionId: sessionId, packet: packet }, 1),
      {
        encoding: 'utf-8',
      }
    );

    switch (packet.event) {
      case 'play-video':
        console.log(sessionId + "'s video is playing");

        io.emit(sessionId, packet);

        break;

      case 'pause-video':
        console.log(sessionId + "'s video is paused");

        io.emit(sessionId, packet);

        break;

      case 'time-changed':
        console.log(sessionId + "'s time changed.");

        io.emit(sessionId, packet);

        break;

      default:
        break;
    }
  });
});

(async () => {
  app.use(cors('*'));
  app.use(compression());
  app.use(json());
  app.use(urlencoded({ extended: false }));
  app.use(session({ secret: process.env.ROOT_PASSWORD }));
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');
  app.use(express.static(__dirname + '/public'));

  app.get('/', async (request, response) => {
    response.render('pages/welcome');
  });

  app.get('/host', async (request, response) => {
    response.render('pages/host');
  });

  app.get('/viewer', async (request, response) => {
    response.render('pages/viewer');
  });

  app.get('/video/:videoId', async (request, response) => {
    let videoId = request.params.videoId;

    let video = videos.filter((video) => video.videoId === videoId)[0];

    if (!video) return response.status(404);

    let range = request.headers.range;
    if (!range) {
      res.status(400).send('Requires Range header');
    }

    let videoSize = fs.statSync(video.videoPath).size;
    let CHUNK_SIZE = 10 ** 6; // 1MB
    let start = Number(range.replace(/\D/g, ''));
    let end = Math.min(start + CHUNK_SIZE, videoSize - 1);
    let contentLength = end - start + 1;

    let headers = {
      'Content-Range': `bytes ${start}-${end}/${videoSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': contentLength,
      'Content-Type': 'video/mp4',
    };

    response.writeHead(206, headers);

    let videoStream = fs.createReadStream(video.videoPath, { start, end });

    videoStream.pipe(response);
  });

  app.get('/**', async (request, response) => {
    response.render('pages/404.ejs');
  });

  http.listen(port, () =>
    logger.success(`HTTP listening on http://localhost:${port}`)
  );

  if (!devmode) {
    https.listen(secure_port, () =>
      logger.success(`HTTPS listening on https://localhost:${secure_port}`)
    );
  }
})();
