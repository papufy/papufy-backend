import jwt, {
  JsonWebTokenError,
  TokenExpiredError,
  type SignOptions,
} from "jsonwebtoken";
import { env } from "../config/env";
import { unauthorized } from "./errors";

export interface JwtPayload {
  sub: string;
  email: string;
}

export function signToken(payload: JwtPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
    algorithm: "HS256",
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyToken(token: string): JwtPayload {
  if (!token || token.length > 4096) {
    throw unauthorized();
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    if (
      typeof decoded !== "object" ||
      decoded === null ||
      typeof (decoded as JwtPayload).sub !== "string" ||
      typeof (decoded as JwtPayload).email !== "string"
    ) {
      throw unauthorized();
    }

    return decoded as JwtPayload;
  } catch (err) {
    if (err instanceof TokenExpiredError || err instanceof JsonWebTokenError) {
      throw unauthorized();
    }
    if (err instanceof Error && "statusCode" in err) {
      throw err;
    }
    throw unauthorized();
  }
}
