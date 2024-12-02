# Menggunakan base image Node.js
FROM node:14.21.2-alpine

# Menetapkan direktori kerja dalam container
WORKDIR /app

# Menetapkan environment variable PORT ke 5000 (sesuaikan dengan aplikasi Anda)
ENV PORT 5000

# Menyalin semua file dari direktori lokal ke dalam container
COPY . .

# Menginstal dependencies
RUN npm install

# Mengekspos port yang digunakan oleh aplikasi
EXPOSE 5000

# Perintah untuk menjalankan aplikasi
CMD [ "npm", "run", "start" ]
