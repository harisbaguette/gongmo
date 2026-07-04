// VAPID 키쌍 생성 → .env 에 복사할 값 출력
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('아래 값을 .env 에 붙여넣으세요 (VAPID_SUBJECT 는 본인 이메일로):\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
