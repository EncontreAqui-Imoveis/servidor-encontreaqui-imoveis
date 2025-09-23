FROM node:20-alpine

WORKDIR /usr/app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

RUN npm run build

EXPOSE 3333

CMD ["npm", "run", "start"]
