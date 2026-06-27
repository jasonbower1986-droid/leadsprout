const bcrypt = require('bcryptjs');
const hash = '$2a$10$YE/epXKnFUXNtqdvXC423ejnEyg3JGV03CxYTZaHyrPMtG.h7IsQC';
const password = 'password123';

bcrypt.compare(password, hash, (err, res) => {
    if (res) {
        console.log("Match!");
    } else {
        console.log("No match.");
    }
});
