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
import './sign-in.css'

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
          <span>数字员工</span>
          <i aria-hidden='true' />
          <span className='login-brand-caption'>AGENT WORKSPACE</span>
        </a>
        <button className='login-help-link' onClick={() => setInfo('help')}>
          帮助中心 <ArrowUpRight size={17} aria-hidden='true' />
        </button>
      </header>
      <main className='login-main'>
        <section className='login-story' aria-labelledby='login-story-title'>
          <div className='login-story-copy'>
            <p className='login-eyebrow'>YOUR NEXT TEAMMATE</p>
            <h1 id='login-story-title'>
              你的下一位同事，
              <br />
              已经就位。
            </h1>
            <p className='login-story-description'>
              让数字员工融入团队，把时间留给更有价值的事。
            </p>
          </div>
          <div className='login-artwork' aria-hidden='true'>
            <div className='login-orbit' />
            <div className='login-orbit-satellite'>
              <i />
            </div>
            <span className='login-cross login-cross-one'>＋</span>
            <span className='login-cross login-cross-two'>＋</span>
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
              <span>Alex / 任务协作</span>
              <small>
                <i />
                在线
              </small>
            </div>
            <div className='login-chart-card'>
              <span />
              <span />
              <span />
              <span />
            </div>
            <p className='login-art-note login-art-note-left'>
              数据分析
              <br />
              报告生成
              <br />
              洞察建议<span>—</span>
            </p>
            <div className='login-workflow-card'>
              <i />
              <i />
              <i />
              <span />
            </div>
            <p className='login-art-note login-art-note-right'>
              流程执行
              <br />
              任务跟进
              <br />
              自动反馈<span>—</span>
            </p>
            <div className='login-task-card'>
              <span>
                <Check />
                项目规划
              </span>
              <span>
                <Check />
                任务分配
              </span>
              <span>
                <Check />
                进度跟进
              </span>
            </div>
          </div>
          <p className='login-story-footer'>
            <Sparkle size={22} fill='currentColor' aria-hidden='true' />
            理解目标 · 连接工具 · 完成工作
          </p>
        </section>
        <section className='login-panel' aria-labelledby='login-title'>
          <div className='login-panel-heading'>
            <h2 id='login-title'>欢迎回来</h2>
            <p>登录你的数字员工工作空间</p>
          </div>
          <UserAuthForm redirectTo={redirect} />
          <p className='login-legal'>
            登录前请了解
            <button onClick={() => setInfo('terms')}>《用户协议》</button>和
            <button onClick={() => setInfo('privacy')}>《隐私政策》</button>
          </p>
        </section>
      </main>
      <footer className='login-page-footer'>
        为人机协作而生。<span>Synapse</span>
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
