const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
    try{
        req.user = jwt.verify(req.cookies.token, process.env.JWT_SECRET, { algorithms: ['HS256'] }); 
        next();
    } catch {
        res.status(401).json({ message: 'No autorizado' })
    }
}

module.exports = { requireAuth };