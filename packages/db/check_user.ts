import { PrismaClient } from '@prisma/client';
import { decryptToken } from './src';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst();
  if (user) {
    console.log('User:', user.username);
    try {
      const token = decryptToken(user.githubAccessToken);
      console.log('Decrypted Token:', token);
    } catch (e) {
      console.log('Decrypt failed:', e.message);
    }
  } else {
    console.log('No users found.');
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
