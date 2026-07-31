# Oftalmoplus - Absenteísmo & Reagendamento

Dashboard em React + Vite para acompanhar faltas, reagendamentos e status operacionais a partir de uma planilha do Google Sheets.

## Requisitos

- Node.js 22
- npm

## Instalação

```bash
npm install
```

## Desenvolvimento

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Deploy

O projeto gera arquivos estáticos em `dist/` e pode ser publicado em qualquer host de front-end estático.

## Fonte de dados

O dashboard consome uma planilha publicada do Google Sheets. Se a origem mudar, atualize a constante `SHEETS_CSV_URL` em `DashboardOftalmoplus.jsx`.

## Estrutura

- `src/` aplicação principal
- `DashboardOftalmoplus.jsx` dashboard principal
- `dist/` build de produção

## Licença

MIT
