const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// IN-MEMORY STORAGE
// ============================================================
const games = new Map();    // gameId -> game state
const quizzes = new Map();  // quizId -> quiz data

// ============================================================
// HELPERS
// ============================================================
function generatePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function createGame(quizId, hostSocketId) {
  const quiz = quizzes.get(quizId);
  if (!quiz) return null;

  let pin = generatePin();
  while ([...games.values()].some(g => g.pin === pin)) {
    pin = generatePin();
  }

  const gameId = generateId();
  const game = {
    id: gameId,
    pin,
    quizId,
    hostSocketId,
    state: 'waiting',       // waiting | question | lobby | finished
    currentQuestion: -1,
    players: new Map(),     // socketId -> { name, score, avatar, answers }
    questionStartTime: null,
    questionDuration: null,
    questionResults: null,
    createdAt: Date.now()
  };

  games.set(gameId, game);
  return game;
}

function calculateScore(timeMs, maxTimeMs) {
  // Skor mirip Kahoot: max 1000 poin, berkurang seiring waktu
  const ratio = Math.max(0, 1 - (timeMs / maxTimeMs));
  return Math.round(500 + 500 * ratio);
}

// ============================================================
// HTTP ROUTES
// ============================================================

// Create quiz
app.post('/api/quiz', (req, res) => {
  const { title, questions } = req.body;
  if (!title || !questions || questions.length === 0) {
    return res.status(400).json({ error: 'Title and questions required' });
  }
  const quizId = generateId();
  quizzes.set(quizId, { id: quizId, title, questions, createdAt: Date.now() });
  res.json({ quizId, title, questionCount: questions.length });
});

// Get quiz
app.get('/api/quiz/:id', (req, res) => {
  const quiz = quizzes.get(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  res.json(quiz);
});

// Create game (start hosting)
app.post('/api/game', (req, res) => {
  const { quizId } = req.body;
  const game = createGame(quizId, null);
  if (!game) return res.status(404).json({ error: 'Quiz not found' });
  res.json({ gameId: game.id, pin: game.pin });
});

// Get game status
app.get('/api/game/:id', (req, res) => {
  const game = games.get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  res.json({
    id: game.id,
    pin: game.pin,
    state: game.state,
    playerCount: game.players.size,
    currentQuestion: game.currentQuestion
  });
});

// Validate PIN (player join)
app.post('/api/join', (req, res) => {
  const { pin } = req.body;
  const game = [...games.values()].find(g => g.pin === pin && g.state === 'waiting');
  if (!game) {
    return res.status(404).json({ error: 'PIN tidak valid atau game sudah dimulai' });
  }
  res.json({ gameId: game.id, quizTitle: quizzes.get(game.quizId)?.title || 'Quiz' });
});

// Serve pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/host/:gameId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));
app.get('/game/:gameId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));

// ============================================================
// SOCKET.IO
// ============================================================
io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);

  // ---- HOST joins ----
  socket.on('host:join', ({ gameId }) => {
    const game = games.get(gameId);
    if (!game) return socket.emit('error', { msg: 'Game tidak ditemukan' });
    game.hostSocketId = socket.id;
    socket.join(`game:${gameId}`);
    socket.gameId = gameId;
    socket.role = 'host';
    console.log(`🎮 Host joined game ${gameId} (PIN: ${game.pin})`);
  });

  // ---- HOST: Start game ----
  socket.on('host:start', ({ gameId }) => {
    const game = games.get(gameId);
    if (!game || game.hostSocketId !== socket.id) return;
    if (game.players.size === 0) return socket.emit('error', { msg: 'Belum ada pemain!' });

    game.state = 'lobby';
    // Kirim semua player ke lobby, lalu mulai
    io.to(`game:${gameId}`).emit('game:starting', { countdown: 3 });

    setTimeout(() => {
      game.currentQuestion = 0;
      game.state = 'question';
      sendQuestion(game);
    }, 4000);
  });

  // ---- HOST: Next question ----
  socket.on('host:next', ({ gameId }) => {
    const game = games.get(gameId);
    if (!game || game.hostSocketId !== socket.id) return;

    const quiz = quizzes.get(game.quizId);
    game.currentQuestion++;

    if (game.currentQuestion >= quiz.questions.length) {
      // Game selesai
      game.state = 'finished';
      const results = getFinalResults(game);
      io.to(`game:${gameId}`).emit('game:finished', { results });
    } else {
      game.state = 'question';
      sendQuestion(game);
    }
  });

  // ---- HOST: Show leaderboard ----
  socket.on('host:leaderboard', ({ gameId }) => {
    const game = games.get(gameId);
    if (!game || game.hostSocketId !== socket.id) return;
    game.state = 'leaderboard';
    const leaderboard = getLeaderboard(game);
    io.to(`game:${gameId}`).emit('show:leaderboard', { leaderboard });
  });

  // ---- PLAYER joins ----
  socket.on('player:join', ({ gameId, name }) => {
    const game = games.get(gameId);
    if (!game) return socket.emit('error', { msg: 'Game tidak ditemukan' });

    // Cek apakah ini reconnect (nama sudah ada di game)
    const existingEntry = [...game.players.entries()].find(
      ([, p]) => p.name.toLowerCase() === name.toLowerCase()
    );

    if (existingEntry) {
      // RECONNECT: transfer data lama ke socket baru
      const [oldSocketId, playerData] = existingEntry;
      game.players.delete(oldSocketId);
      game.players.set(socket.id, playerData);

      socket.join(`game:${gameId}`);
      socket.gameId = gameId;
      socket.role = 'player';

      socket.emit('player:joined-self', {
        name,
        avatar: playerData.avatar,
        playerCount: game.players.size
      });

      // Kalau sedang ada pertanyaan aktif, kirim ulang
      if (game.state === 'question' && game.currentQuestion >= 0) {
        const quiz = quizzes.get(game.quizId);
        const q = quiz.questions[game.currentQuestion];
        socket.emit('question:new', {
          questionIndex: game.currentQuestion,
          totalQuestions: quiz.questions.length,
          question: q.question,
          options: q.options,
          timeLimit: q.timeLimit || 20,
          category: q.category || null,
          startTime: game.questionStartTime
        });
      } else if (game.state === 'finished') {
        socket.emit('game:finished', { results: getFinalResults(game) });
      }

      console.log(`🔄 ${name} reconnected to game ${gameId}`);
      return;
    }

    // NEW PLAYER: hanya bisa join saat waiting
    if (game.state !== 'waiting') {
      return socket.emit('error', { msg: 'Game sudah dimulai, tidak bisa join' });
    }

    const avatar = getRandomAvatar();
    game.players.set(socket.id, {
      name,
      score: 0,
      correctCount: 0,
      totalAnswered: 0,
      avatar
    });

    socket.join(`game:${gameId}`);
    socket.gameId = gameId;
    socket.role = 'player';

    io.to(`game:${gameId}`).emit('player:count', { count: game.players.size });

    // STAGING: broadcast info pemain baru + daftar pemain ke host
    io.to(`game:${gameId}`).emit('player:joined', {
      player: { name, avatar },
      playerCount: game.players.size,
      players: getPlayersList(game)
    });

    socket.emit('player:joined-self', {
      name,
      avatar,
      playerCount: game.players.size
    });

    console.log(`👤 ${name} joined game ${gameId} (${game.players.size} players)`);
  });

  // ---- PLAYER: Answer ----
  socket.on('player:answer', ({ gameId, answerIndex }) => {
    const game = games.get(gameId);
    if (!game || game.state !== 'question') return;

    const player = game.players.get(socket.id);
    if (!player) return;
    if (player._answered) return; // sudah jawab

    const quiz = quizzes.get(game.quizId);
    const question = quiz.questions[game.currentQuestion];
    const timeElapsed = Date.now() - game.questionStartTime;
    const isCorrect = answerIndex === question.correctIndex;

    player._answered = true;
    player.totalAnswered++;
    player.lastAnswer = {
      answerIndex,
      isCorrect,
      correctAnswer: question.correctIndex,
      timeElapsed
    };

    if (isCorrect) {
      const points = calculateScore(timeElapsed, game.questionDuration);
      player.score += points;
      player.correctCount++;
      player.lastPoints = points;
    } else {
      player.lastPoints = 0;
    }

    // Kirim konfirmasi ke pemain yang menjawab
    socket.emit('answer:confirmed', {
      isCorrect,
      correctAnswer: question.correctIndex,
      points: player.lastPoints,
      totalScore: player.score
    });

    // Kirim jumlah yang sudah jawab ke host
    const answeredCount = [...game.players.values()].filter(p => p._answered).length;
    io.to(`game:${gameId}`).emit('player:answered', {
      answeredCount,
      totalPlayers: game.players.size
    });

    console.log(`📝 ${player.name} answered: ${isCorrect ? '✅' : '❌'} (${answeredCount}/${game.players.size})`);
  });

  // ---- HOST: Reveal answer ----
  socket.on('host:reveal', ({ gameId }) => {
    const game = games.get(gameId);
    if (!game || game.hostSocketId !== socket.id) return;

    const quiz = quizzes.get(game.quizId);
    const question = quiz.questions[game.currentQuestion];
    const leaderboard = getLeaderboard(game);

    // Hitung statistik jawaban
    const answerStats = [0, 0, 0, 0];
    [...game.players.values()].forEach(p => {
      if (p._answered) answerStats[p.lastAnswer.answerIndex]++;
    });

    game.state = 'lobby';
    io.to(`game:${gameId}`).emit('answer:reveal', {
      correctAnswer: question.correctIndex,
      explanation: question.explanation || null,
      leaderboard,
      answerStats
    });
  });

  // ---- DISCONNECT ----
  socket.on('disconnect', () => {
    console.log(`🔌 Disconnected: ${socket.id}`);

    if (socket.gameId) {
      const game = games.get(socket.gameId);
      if (!game) return;

      if (socket.role === 'host') {
        // Host disconnect → tutup game
        io.to(`game:${socket.gameId}`).emit('game:host-left');
        games.delete(socket.gameId);
        console.log(`❌ Game ${socket.gameId} closed (host left)`);
      } else if (socket.role === 'player') {
        const player = game.players.get(socket.id);
        game.players.delete(socket.id);
        if (player) {
          io.to(`game:${socket.gameId}`).emit('player:count', { count: game.players.size });
          console.log(`👤 ${player.name} left game ${socket.gameId} (${game.players.size} players)`);
        }
      }
    }
  });
});

// ============================================================
// GAME HELPERS
// ============================================================
function sendQuestion(game) {
  const quiz = quizzes.get(game.quizId);
  const q = quiz.questions[game.currentQuestion];

  // Reset player answers
  [...game.players.values()].forEach(p => {
    p._answered = false;
    p.lastAnswer = null;
    p.lastPoints = 0;
  });

  game.questionStartTime = Date.now();
  game.questionDuration = (q.timeLimit || 20) * 1000;

  // Kirim pertanyaan ke semua (tanpa jawaban benar!)
  io.to(`game:${game.id}`).emit('question:new', {
    questionIndex: game.currentQuestion,
    totalQuestions: quiz.questions.length,
    question: q.question,
    options: q.options,
    timeLimit: q.timeLimit || 20,
    category: q.category || null,
    startTime: game.questionStartTime
  });

  // Auto-reveal setelah waktu habis
  setTimeout(() => {
    if (game.state === 'question' && game.currentQuestion === quiz.questions.indexOf(q)) {
      const leaderboard = getLeaderboard(game);
      const answerStats = [0, 0, 0, 0];
      [...game.players.values()].forEach(p => {
        if (p._answered) answerStats[p.lastAnswer.answerIndex]++;
      });

      game.state = 'lobby';
      io.to(`game:${game.id}`).emit('answer:reveal', {
        correctAnswer: q.correctIndex,
        explanation: q.explanation || null,
        leaderboard,
        answerStats
      });
    }
  }, game.questionDuration + 500); // 500ms buffer
}

function getLeaderboard(game) {
  return [...game.players.entries()]
    .map(([socketId, p]) => ({
      socketId,
      name: p.name,
      score: p.score,
      correctCount: p.correctCount,
      totalAnswered: p.totalAnswered,
      avatar: p.avatar
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50); // Top 50 saja untuk performa
}

function getPlayersList(game) {
  return [...game.players.values()]
    .map(p => ({ name: p.name, avatar: p.avatar }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getFinalResults(game) {
  return [...game.players.entries()]
    .map(([socketId, p]) => ({
      name: p.name,
      score: p.score,
      correctCount: p.correctCount,
      totalAnswered: p.totalAnswered,
      accuracy: p.totalAnswered > 0
        ? Math.round((p.correctCount / p.totalAnswered) * 100)
        : 0,
      avatar: p.avatar
    }))
    .sort((a, b) => b.score - a.score);
}

function getRandomAvatar() {
  const avatars = ['🦊','🐶','🐱','🐼','🦁','🐸','🐵','🦄','🐲','🐙',
                   '🦋','🐧','🦉','🐝','🦈','🐳','🦀','🦜','🐺','🦅'];
  return avatars[Math.floor(Math.random() * avatars.length)];
}

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮 Kahoot Clone running at http://localhost:${PORT}`);
  console.log(`   Admin:   http://localhost:${PORT}/admin`);
  console.log(`   Play:    http://localhost:${PORT}/play\n`);
});
