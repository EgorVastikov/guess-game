FROM node:20-alpine

WORKDIR /app

COPY package.json ./

COPY api ./api
COPY public ./public
COPY dev-local.js ./
COPY README.md ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dev-local.js"]
