import { type ReactNode } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Badge } from '../ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import {
  type NavCollapsible,
  type NavItem,
  type NavLink,
  type NavGroup as NavGroupProps,
} from './types'
import { LocalizedText } from '@/components/localized-text'



export function NavGroup({ title, items }: NavGroupProps) {
  const { state, isMobile } = useSidebar()
  const href = useLocation({ select: (location) => location.href })
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{title}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const key = `${item.title}-${'url' in item ? item.url : ''}`
          if (!Array.isArray(item.items)) return <SidebarMenuLink key={key} item={item as NavLink} href={href} />
          const collapsibleItem = item as NavCollapsible
          if (state === 'collapsed' && !isMobile) return <SidebarMenuCollapsedDropdown key={key} item={collapsibleItem} href={href} />
          return <SidebarMenuCollapsible key={key} item={collapsibleItem} href={href} />
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function NavBadge({ children }: { children: ReactNode }) {
  return <Badge className='rounded-full px-1 py-0 text-xs'>{children}</Badge>
}

function SidebarMenuLink({ item, href }: { item: NavLink; href: string }) {
  const { setOpenMobile } = useSidebar()
  const content = <>{item.icon && <item.icon />}<span>{item.title}</span>{item.badge && <NavBadge>{item.badge}</NavBadge>}</>
  return <SidebarMenuItem><SidebarMenuButton asChild isActive={checkIsActive(href, item)} tooltip={item.title}>
    {item.external ? <a href={item.url} target='_blank' rel='noreferrer' onClick={() => setOpenMobile(false)}>{content}</a> : <Link to={item.url} onClick={() => setOpenMobile(false)}>{content}</Link>}
  </SidebarMenuButton></SidebarMenuItem>
}

function SidebarMenuCollapsible({ item, href }: { item: NavCollapsible; href: string }) {
  const { setOpenMobile } = useSidebar()
  return <Collapsible asChild defaultOpen={checkIsActive(href, item, true)} className='group/collapsible'>
    <SidebarMenuItem>
      <CollapsibleTrigger asChild><SidebarMenuButton tooltip={item.title}>{item.icon && <item.icon />}<span>{item.title}</span>{item.badge && <NavBadge>{item.badge}</NavBadge>}<ChevronRight className='ms-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 rtl:rotate-180' /></SidebarMenuButton></CollapsibleTrigger>
      <CollapsibleContent className='CollapsibleContent'><SidebarMenuSub>
        {item.items.map((subItem) => <SidebarMenuSubItem key={subItem.title}><SidebarMenuSubButton asChild isActive={checkIsActive(href, subItem)}>
          {subItem.external ? <a href={subItem.url} target='_blank' rel='noreferrer' onClick={() => setOpenMobile(false)}>{subItem.icon && <subItem.icon />}<span>{subItem.title}</span>{subItem.badge && <NavBadge>{subItem.badge}</NavBadge>}</a> : <Link to={subItem.url} onClick={() => setOpenMobile(false)}>{subItem.icon && <subItem.icon />}<span>{subItem.title}</span>{subItem.badge && <NavBadge>{subItem.badge}</NavBadge>}</Link>}
        </SidebarMenuSubButton></SidebarMenuSubItem>)}
      </SidebarMenuSub></CollapsibleContent>
    </SidebarMenuItem>
  </Collapsible>
}

function SidebarMenuCollapsedDropdown({ item, href }: { item: NavCollapsible; href: string }) {
  return <SidebarMenuItem><DropdownMenu>
    <DropdownMenuTrigger asChild><SidebarMenuButton tooltip={item.title} isActive={checkIsActive(href, item)}>{item.icon && <item.icon />}<span>{item.title}</span>{item.badge && <NavBadge>{item.badge}</NavBadge>}<ChevronRight className='ms-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90' /></SidebarMenuButton></DropdownMenuTrigger>
    <DropdownMenuContent side='right' align='start' sideOffset={4}><DropdownMenuLabel>{item.title} {item.badge ? `(${item.badge})` : <LocalizedText text={""} />}</DropdownMenuLabel><DropdownMenuSeparator />
      {item.items.map((sub) => <DropdownMenuItem key={`${sub.title}-${sub.url}`} asChild>
        {sub.external ? <a href={sub.url} target='_blank' rel='noreferrer' className={checkIsActive(href, sub) ? "bg-secondary" : ""}>{sub.icon && <sub.icon />}<span className='max-w-52 text-wrap'>{sub.title}</span>{sub.badge && <span className='ms-auto text-xs'>{sub.badge}</span>}</a> : <Link to={sub.url} className={checkIsActive(href, sub) ? "bg-secondary" : ""}>{sub.icon && <sub.icon />}<span className='max-w-52 text-wrap'>{sub.title}</span>{sub.badge && <span className='ms-auto text-xs'>{sub.badge}</span>}</Link>}
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu></SidebarMenuItem>
}

function checkIsActive(href: string, item: NavItem, mainNav = false) {
  return href === item.url || href.split('?')[0] === item.url ||
    ('items' in item && !!item.items?.filter((i) => i.url === href).length) ||
    (mainNav && href.split('/')[1] !== '' && href.split('/')[1] === item.url?.split('/')[1])
}
