# Site de assinaturas da Liliane Melo — versão inicial funcional

## O que já faz
- Perfil público mobile-first, sem cadastro ou e-mail do assinante.
- Planos de 7, 15 e 30 dias.
- Chave Pix exibida somente após escolher um plano.
- Envio de comprovante de imagem.
- Painel `/admin` protegido por senha para aprovar/recusar pedidos.
- Upload e remoção de fotos exclusivas pelo painel.
- As fotos originais são armazenadas em pasta privada e só são servidas para uma sessão com assinatura aprovada e ainda válida. Para a galeria pública, o servidor gera prévias menores, comprimidas e levemente desfocadas.

## Antes de usar
1. Instale Node.js 18 ou superior.
2. Na pasta do projeto, copie `.env.example` para `.env`.
3. Edite `.env`: defina `SESSION_SECRET` longo e aleatório, uma senha forte em `ADMIN_PASSWORD`, a chave Pix já registrada no banco e o nome/cidade do recebedor.
4. Instale dependências com `npm install`.
5. Inicie com `npm start`.
6. Abra `http://localhost:3000`. Painel: `http://localhost:3000/admin`.

## Fotos de capa e perfil
Coloque os arquivos autorizados em:
- `public/profile.jpg`
- `public/cover.jpg`

Você pode trocar as imagens a qualquer momento. Não envie imagens de outra pessoa sem consentimento explícito.

## Limitações importantes
- Este projeto faz **aprovação manual**: a imagem do comprovante é enviada ao painel e o administrador confere o crédito real na conta antes de clicar em “Aprovar pagamento”. Não existe análise automática confiável de comprovante nesta versão.
- No checkout, o site gera um QR Code Pix estático com o valor do plano e um TXID aleatório por pedido, usando a chave Pix já registrada no banco. O dinheiro é enviado à conta vinculada a essa chave; o site não cria nem registra chaves Pix no banco.
- O QR Code e o código Pix Copia e Cola não confirmam o crédito automaticamente. Confira o recebimento no banco antes de aprovar o comprovante. Cobranças dinâmicas e confirmação automática exigem integração com uma instituição/provedor Pix.
- Para colocar na internet, use hospedagem que rode Node.js, HTTPS e armazenamento persistente. GitHub Pages sozinho não executa o servidor.
- A versão inicial guarda dados em JSON e sessões no armazenamento padrão do Express; para produção é necessário trocar para banco de dados persistente, armazenamento de sessão seguro, proteção contra abuso/rate limits, backups e configuração HTTPS.
- A aprovação libera o acesso na mesma sessão/navegador usado para enviar o comprovante. Para acesso confiável em vários dispositivos, adicione links de acesso privados e de uso limitado.
- Use a marca OnlyFans somente se tiver autorização para isso; caso contrário, substitua o texto/logo por uma marca própria.
- Use somente fotos de pessoas adultas que autorizaram expressamente a publicação e venda. Verifique as leis aplicáveis e os termos do provedor de pagamento/hospedagem.
