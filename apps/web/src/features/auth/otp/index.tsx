import { Link } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { OtpForm } from './components/otp-form'
import { LocalizedText } from '@/components/localized-text'

export function Otp() {
  return (
    <AuthLayout>
      <Card className='max-w-md gap-4'>
        <CardHeader>
          <CardTitle className='text-base tracking-tight'>
            <LocalizedText text={"\n            Two-factor Authentication\n          "} /></CardTitle>
          <CardDescription>
            <LocalizedText text={"\n            Please enter the authentication code. "} /><br /> <LocalizedText text={" We have sent the\n            authentication code to your email.\n          "} /></CardDescription>
        </CardHeader>
        <CardContent>
          <OtpForm />
        </CardContent>
        <CardFooter>
          <p className='px-8 text-center text-sm text-muted-foreground'>
            <LocalizedText text={"\n            Haven't received it?"} />{' '}
            <Link
              to='/sign-in'
              className='underline underline-offset-4 hover:text-primary'
            >
              <LocalizedText text={"\n              Resend a new code.\n            "} /></Link>
            <LocalizedText text={"\n            .\n          "} /></p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
