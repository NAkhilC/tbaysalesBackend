const bcrypt = require("bcrypt");
const encyrptPassword = async (password) => {
    const saltRounds = Number(process.env.SALT_ROUNDS)
    return await bcrypt
        .hash(password, saltRounds)
        .then(hash => {
            return hash;
        })
        .catch(err => console.error(err.message))
}

const comparePassword = async (password, hash) => {
    return await bcrypt
        .compare(password, hash)
        .then(res => {
            return res; // return true
        })
        .catch(err => console.error(err.message))
}

module.exports = {
    encyrptPassword,
    comparePassword
}