FROM node:24-alpine

WORKDIR /usr/app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build
RUN npm prune --omit=dev

EXPOSE 3333
CMD ["npm", "run", "start"]

