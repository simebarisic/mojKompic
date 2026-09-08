// Generira bcrypt hash lozinke za AUTH_PASSWORD_HASH u .env (prava/prod
// instanca - vidi server.js). Pokreni s "npm run hash-password" (lokalno na
// Macu, ili preko "docker compose exec app npm run hash-password" na serveru
// nakon što je image izgrađen). Lozinka se maskira zvjezdicama dok je tipkaš
// i NIGDJE se ne sprema u čistom obliku - samo bcrypt hash ispisan na kraju,
// kojeg ručno prekopiraš u .env.
import readline from 'readline';
import bcrypt from 'bcryptjs';

// Kodovi kontrolnih znakova (izbjegava pisanje sirovih kontrolnih znakova u
// izvornom kodu - neki alati/editori ih znaju tiho izbrisati ili iskvariti).
const KEY_ENTER = 13;
const KEY_NEWLINE = 10;
const KEY_CTRL_C = 3;
const KEY_CTRL_D = 4;
const KEY_BACKSPACE = 127;
const KEY_BACKSPACE_ALT = 8;

function askPasswordMasked(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let password = '';

    const onData = (buf) => {
      const code = buf.length === 1 ? buf[0] : -1;

      if (code === KEY_ENTER || code === KEY_NEWLINE || code === KEY_CTRL_D) {
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode?.(false);
        process.stdout.write('\n');
        rl.close();
        resolve(password);
        return;
      }
      if (code === KEY_CTRL_C) {
        process.stdout.write('\n');
        process.exit(1);
        return;
      }
      if (code === KEY_BACKSPACE || code === KEY_BACKSPACE_ALT) {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      password += buf.toString();
      process.stdout.write('*');
    };

    process.stdout.write(prompt);
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

async function main() {
  const isTTY = process.stdin.isTTY;
  const password = isTTY
    ? await askPasswordMasked('Nova lozinka za "Moj Kompić": ')
    : await new Promise((resolve) => {
        // Bez TTY-a (npr. cijev u drugi proces) - obična linija, bez maskiranja.
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('Nova lozinka za "Moj Kompić": ', (answer) => { rl.close(); resolve(answer); });
      });

  if (!password || password.length < 6) {
    console.error('\nLozinka mora imati barem 6 znakova. Pokušaj ponovno: npm run hash-password');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  console.log('\nGotovo. Dodaj ovo u .env na serveru (i u GitHub Secret AUTH_PASSWORD_HASH ako koristiš deploy.yml):\n');
  console.log(`AUTH_PASSWORD_HASH=${hash}\n`);
}

main();
