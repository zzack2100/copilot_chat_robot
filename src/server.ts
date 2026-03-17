//Create a basic express server that listens on port 3000
import express from 'express';
const app = express();
app.use(express.json());
const port = 3000;
app.get('/', (req, res) => {
// Create a Post reute for /agent/task that returns a json object with a message
//  "AI Agent is ready!"
res.send('AI Agent is ready!');
});

app.post('/agent/task', (req, res) => {
  const { task } = req.body;
  res.json({ 
    status: 'success', 
    received_task: task,
     message: `Agent is now working on: ${task}`
  });
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});

