/**
 * Datos de ejemplo: planes, superadministrador y un local de demostración
 * con profesionales, servicios y horarios.
 *   npm run db:seed
 */
import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL as string) });
const h = (hh: number, mm = 0) => hh * 60 + mm;

async function main() {
  for (const plan of [
    {
      code: 'BASICO',
      name: 'Básico',
      priceCents: 1500,
      maxProfessionals: 2,
      monthlyMessageQuota: 500,
      monthlyAiQuota: 300,
    },
    {
      code: 'PRO',
      name: 'Profesional',
      priceCents: 3000,
      maxProfessionals: 6,
      monthlyMessageQuota: 2000,
      monthlyAiQuota: 1000,
    },
    {
      code: 'PREMIUM',
      name: 'Premium',
      priceCents: 5000,
      maxProfessionals: 20,
      monthlyMessageQuota: 6000,
      monthlyAiQuota: 3000,
    },
  ]) {
    await prisma.plan.upsert({ where: { code: plan.code }, create: plan, update: plan });
  }

  const adminPassword = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD ?? 'admin12345', 10);
  await prisma.user.upsert({
    where: { email: 'admin@plataforma.local' },
    create: { email: 'admin@plataforma.local', name: 'Administrador', role: 'SUPERADMIN', passwordHash: adminPassword },
    update: {},
  });

  if (await prisma.tenant.findUnique({ where: { slug: 'demo' } })) {
    console.log('Local demo ya existe; seed terminado.');
    return;
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Peluquería Demo',
      slug: 'demo',
      whatsappNumber: '593990000001',
      address: 'Av. Amazonas y Naciones Unidas, Quito',
      assistantInfo:
        'Aceptamos efectivo, transferencia y tarjeta. Hay parqueadero gratuito para clientes. No atendemos domingos. Los tintes incluyen lavado y secado.',
      status: 'TRIAL',
      trialEndsAt: new Date(Date.now() + 30 * 86_400_000),
      users: {
        create: {
          email: 'dueno@demo.local',
          name: 'Dueño Demo',
          role: 'OWNER',
          passwordHash: await bcrypt.hash('demo12345', 10),
        },
      },
    },
  });

  const [corte, barba, tinte] = await Promise.all([
    prisma.service.create({
      data: { tenantId: tenant.id, name: 'Corte de cabello', durationMinutes: 30, priceCents: 800 },
    }),
    prisma.service.create({ data: { tenantId: tenant.id, name: 'Barba', durationMinutes: 20, priceCents: 500 } }),
    prisma.service.create({
      data: { tenantId: tenant.id, name: 'Tinte', durationMinutes: 120, bufferMinutes: 15, priceCents: 3500 },
    }),
  ]);

  // Lunes a sábado; jornada partida con almuerzo.
  const weekdays = [1, 2, 3, 4, 5, 6];
  const split = weekdays.flatMap((weekday) => [
    { weekday, startMinute: h(9), endMinute: h(13) },
    { weekday, startMinute: h(14), endMinute: h(19) },
  ]);

  await prisma.professional.create({
    data: {
      tenantId: tenant.id,
      name: 'Carlos',
      workingHours: { create: split },
      services: { create: [{ serviceId: corte.id }, { serviceId: barba.id }] },
    },
  });
  await prisma.professional.create({
    data: {
      tenantId: tenant.id,
      name: 'María',
      workingHours: { create: weekdays.map((weekday) => ({ weekday, startMinute: h(10), endMinute: h(18) })) },
      services: { create: [{ serviceId: corte.id, durationMinutes: 40 }, { serviceId: tinte.id }] },
    },
  });

  console.log(`Seed listo. Local demo #${tenant.id}, WhatsApp ${tenant.whatsappNumber}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
