import { useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import { ArrowUpRight, Check, Sparkle } from 'lucide-react'
import synapseMark from '@/assets/brand/synapse-mark.png'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import teammates from './assets/digital-teammates.png'
import { UserAuthForm } from './components/user-auth-form'
import { LanguageSwitch } from '@/components/language-switch'
import './sign-in.css'
import { LocalizedText } from '@/components/localized-text'

const information = {
  help: {
    title: '登录帮助',
    description:
      '使用管理员为你开通的 Synapse 用户名和密码登录。首次使用或忘记密码时，请通过组织内部渠道联系管理员。验证码和企业 SSO 登录将在配置完成后开放。',
  },
  terms: {
    title: '用户协议',
    description:
      '当前部署尚未提供正式用户协议。请联系部署管理员了解服务使用条款；平台不会将此说明视为你已接受正式协议。',
  },
  privacy: {
    title: '隐私政策',
    description:
      '当前部署尚未提供正式隐私政策。请向部署管理员了解数据收集、存储与删除规则。“记住账号”仅在本机保存用户名，不保存密码。',
  },
}

export function SignIn() {
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const [info, setInfo] = useState<keyof typeof information | null>(null)
  return (
    <div className='synapse-login'>
      <header className='login-header'>
        <a
          href='/sign-in'
          className='login-brand'
          aria-label='Synapse 数字员工首页'
        >
          <img className='login-brand-mark' src={synapseMark} alt='' />
          <span><LocalizedText text={"数字员工"} /></span>
          <i aria-hidden='true' />
          <span className='login-brand-caption'><LocalizedText text={"AGENT WORKSPACE"} /></span>
        </a>
        <div className='login-header-actions'>
          <LanguageSwitch />
          <button className='login-help-link' onClick={() => setInfo('help')}>
            <LocalizedText text={"\n          帮助中心 "} /><ArrowUpRight size={17} aria-hidden='true' />
          </button>
        </div>
      </header>
      <main className='login-main'>
        <section className='login-story' aria-labelledby='login-story-title'>
          <div className='login-story-copy'>
            <p className='login-eyebrow'><LocalizedText text={"YOUR NEXT TEAMMATE"} /></p>
            <h1 id='login-story-title'>
              <LocalizedText text={"\n              你的下一位同事，\n              "} /><br />
              <LocalizedText text={"\n              已经就位。\n            "} /></h1>
            <p className='login-story-description'>
              <LocalizedText text={"\n              让数字员工融入团队，把时间留给更有价值的事。\n            "} /></p>
          </div>
          <div className='login-artwork' aria-hidden='true'>
            <div className='login-orbit' />
            <div className='login-orbit-satellite'>
              <i />
            </div>
            <span className='login-cross login-cross-one'><LocalizedText text={"＋"} /></span>
            <span className='login-cross login-cross-two'><LocalizedText text={"＋"} /></span>
            <img
              className='login-teammates'
              src={teammates}
              width='1536'
              height='1024'
              alt=''
              fetchPriority='high'
            />
            <div className='login-particles'>
              {Array.from({ length: 8 }, (_, index) => (
                <i key={index} />
              ))}
            </div>
            <div className='login-agent-card'>
              <span><LocalizedText text={"Alex / 任务协作"} /></span>
              <small>
                <i />
                <LocalizedText text={"\n                在线\n              "} /></small>
            </div>
            <div className='login-chart-card'>
              <span />
              <span />
              <span />
              <span />
            </div>
            <p className='login-art-note login-art-note-left'>
              <LocalizedText text={"\n              数据分析\n              "} /><br />
              <LocalizedText text={"\n              报告生成\n              "} /><br />
              <LocalizedText text={"\n              洞察建议"} /><span><LocalizedText text={"—"} /></span>
            </p>
            <div className='login-workflow-card'>
              <i />
              <i />
              <i />
              <span />
            </div>
            <p className='login-art-note login-art-note-right'>
              <LocalizedText text={"\n              流程执行\n              "} /><br />
              <LocalizedText text={"\n              任务跟进\n              "} /><br />
              <LocalizedText text={"\n              自动反馈"} /><span><LocalizedText text={"—"} /></span>
            </p>
            <div className='login-task-card'>
              <span>
                <Check />
                <LocalizedText text={"\n                项目规划\n              "} /></span>
              <span>
                <Check />
                <LocalizedText text={"\n                任务分配\n              "} /></span>
              <span>
                <Check />
                <LocalizedText text={"\n                进度跟进\n              "} /></span>
            </div>
          </div>
          <p className='login-story-footer'>
            <Sparkle size={22} fill='currentColor' aria-hidden='true' />
            <LocalizedText text={"\n            理解目标 · 连接工具 · 完成工作\n          "} /></p>
        </section>
        <section className='login-panel' aria-labelledby='login-title'>
          <div className='login-panel-heading'>
            <h2 id='login-title'><LocalizedText text={"欢迎回来"} /></h2>
            <p><LocalizedText text={"登录你的数字员工工作空间"} /></p>
          </div>
          <UserAuthForm redirectTo={redirect} />
          <p className='login-legal'>
            <LocalizedText text={"\n            登录前请了解\n            "} /><button onClick={() => setInfo('terms')}><LocalizedText text={"《用户协议》"} /></button><LocalizedText text={"和\n            "} /><button onClick={() => setInfo('privacy')}><LocalizedText text={"《隐私政策》"} /></button>
          </p>
        </section>
      </main>
      <footer className='login-page-footer'>
        <LocalizedText text={"\n        为人机协作而生。"} /><span><LocalizedText text={"Synapse"} /></span>
      </footer>
      <Dialog
        open={info !== null}
        onOpenChange={(open) => !open && setInfo(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{info && information[info].title}</DialogTitle>
            <DialogDescription>
              {info && information[info].description}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  )
}
