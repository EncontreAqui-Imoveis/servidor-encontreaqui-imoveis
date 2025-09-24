import bcrypt from 'bcryptjs';
const hash = '$2a$08$l64jsIX3fgjssgHYopk8QekusGPhg/VtzvfhTdzAI9g.M8IMfCAm.';
bcrypt.compare('admin123', hash).then(result => console.log(result));