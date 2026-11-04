const express = require('express');

const app = express();

app.use(express.json());

app.get('/login', (req, res) => {
    res.send('Login route brou')
})

app.post('/api/login', (req, res) => {
    const { email, password } = req.body

    if(email === 'a@a.com' && password === '1234') {
        res.json({ message: 'Login successful' })
    } else {
        res.status(401).json({ message: 'Invalid credentials' })
    }
})

app.listen(3000, () => {
    console.log('Server is running on port 3000');
})