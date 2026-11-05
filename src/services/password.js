import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// Parâmetros gravados no próprio hash, para que aumentá-los depois não invalide
// as senhas já guardadas. 128 * N * r = 16MB, abaixo do maxmem padrão de 32MB.
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_BYTES = 64;
const SALT_BYTES = 32;

const derive = (password, salt, params = PARAMS) =>
  scryptAsync(password, salt, KEY_BYTES, { N: params.N, r: params.r, p: params.p });

/**
 * Gera `scrypt$N$r$p$sal$hash`, com sal aleatório por usuário (ADR-0011).
 * Duas chamadas com a mesma senha devolvem hashes diferentes — é o sal fazendo
 * seu trabalho: duas pessoas com a mesma senha não têm a mesma linha no banco.
 */
export async function hash(password) {
  const salt = randomBytes(SALT_BYTES);
  const derived = await derive(password, salt);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Refaz o scrypt com o sal guardado e compara em tempo constante.
 * `timingSafeEqual` em vez de `===` para o tempo de resposta não revelar
 * quantos bytes do hash foram acertados.
 * Hash corrompido ou de formato desconhecido devolve `false`, nunca lança.
 */
export async function verify(password, stored) {
  const parsed = parse(stored);
  if (!parsed) return false;

  // Os parâmetros vêm do hash guardado, não das constantes de hoje: aumentar o
  // custo no futuro não pode invalidar as senhas já cadastradas.
  const derived = await derive(password, parsed.salt, parsed.params);
  if (derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
}

// Sal fixo do processo, usado só para gastar tempo. Nunca vai para o banco.
const FAKE_SALT = randomBytes(SALT_BYTES);

/**
 * Gasta o tempo de um scrypt e devolve `false`.
 *
 * Serve ao login quando o e-mail não existe: sem isso, "e-mail inexistente"
 * responderia muito mais rápido que "senha errada", e o relógio contaria o que
 * a mensagem única esconde (ADR-0011).
 */
export async function fakeVerify(password) {
  await derive(typeof password === 'string' ? password : '', FAKE_SALT);
  return false;
}

/** Quebra o formato guardado. Devolve null se não reconhecer. */
function parse(stored) {
  if (typeof stored !== 'string') return null;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return null;

  const salt = Buffer.from(rawSalt, 'base64');
  const hashBytes = Buffer.from(rawHash, 'base64');
  if (salt.length === 0 || hashBytes.length === 0) return null;

  return { salt, hash: hashBytes, params: { N, r, p } };
}
