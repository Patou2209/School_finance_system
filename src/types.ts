// Types partagés pour l'application

export type Role = 'super_admin' | 'admin' | 'enseignant' | 'percepteur' | 'classe'

export type Bindings = {
  DB: D1Database
  JWT_SECRET?: string
}

export type JwtPayload = {
  uid: number
  role: Role
  school_id: number | null
  class_id?: number | null
  name: string
  email: string
  exp: number
}

export type AppEnv = {
  Bindings: Bindings
  Variables: {
    user: JwtPayload
  }
}
