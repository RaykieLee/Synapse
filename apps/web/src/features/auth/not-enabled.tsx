import { Link } from '@tanstack/react-router'
import { AuthLayout } from './auth-layout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function AuthActionNotEnabled({ action }: { action: 'signup' | 'recovery' }) {
  const signup = action === 'signup'
  return <AuthLayout><Card className='max-w-sm gap-4'><CardHeader><CardTitle>{signup ? 'Registration unavailable' : 'Password recovery unavailable'}</CardTitle><CardDescription>{signup ? 'Self-service registration is not enabled. Ask your Synapse administrator to create an account.' : 'Password recovery is not enabled yet. If you can sign in, change your password in Account settings; otherwise contact your Synapse administrator.'}</CardDescription></CardHeader><CardContent><Link className='text-sm underline' to='/sign-in'>Back to sign in</Link></CardContent></Card></AuthLayout>
}
