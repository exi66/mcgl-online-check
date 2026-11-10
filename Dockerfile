FROM node:24-alpine

WORKDIR /app
COPY package.json check.js ./

USER node
CMD ["npm", "start"]
