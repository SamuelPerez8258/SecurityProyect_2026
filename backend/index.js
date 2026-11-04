const express = require('express');

const app = express();

app.use(express.json());

app.get('/login', (req, res) => {
    res.send('Login route brou')
})

app.listen(3000, () => {
    console.log('Server is running on port 3000');
})