/**
 * gen-cert.js
 * 모바일 마이크용 자체서명 SSL 인증서 생성
 * 실행: node gen-cert.js
 */
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const sslDir = path.join(__dirname, 'ssl');
if (!fs.existsSync(sslDir)) fs.mkdirSync(sslDir);

const key  = path.join(sslDir, 'key.pem');
const cert = path.join(sslDir, 'cert.pem');

if (fs.existsSync(key) && fs.existsSync(cert)) {
  console.log('인증서가 이미 존재합니다: ssl/key.pem, ssl/cert.pem');
  process.exit(0);
}

try {
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${key}" -out "${cert}" ` +
    `-days 365 -nodes -subj "/CN=localhost"`,
    { stdio: 'inherit' }
  );
  console.log('\n✅ 인증서 생성 완료: ssl/key.pem, ssl/cert.pem');
  console.log('   npm start 로 서버 재시작하면 HTTPS로 전환됩니다.');
  console.log('   모바일에서 https://[PC-IP]:3443 으로 접속하세요.');
  console.log('   ⚠️  브라우저에서 "안전하지 않음" 경고 → 고급 → 계속 진행\n');
} catch (e) {
  console.error('❌ openssl 명령을 찾을 수 없습니다.');
  console.log('   Windows: https://slproweb.com/products/Win32OpenSSL.html 에서 설치');
  console.log('   또는 Git Bash 사용 시: Git Bash 터미널에서 실행하세요.\n');
  process.exit(1);
}
