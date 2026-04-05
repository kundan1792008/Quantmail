"use client";

import { navItems } from "@/lib/mockData";

interface SidebarProps {
  activeNav: string;
  onNavChange: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

const icons: Record<string, React.ReactNode> = {
  inbox: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z" />
    </svg>
  ),
  sent: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
    </svg>
  ),
  draft: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </svg>
  ),
  spam: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  ),
  star: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
    </svg>
  ),
};

export default function Sidebar({ activeNav, onNavChange, isOpen, onClose }: SidebarProps) {
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`
          fixed top-0 left-0 z-30 h-full w-64 flex flex-col bg-surface-card border-r border-surface-border
          transform transition-transform duration-300 ease-in-out
          md:static md:translate-x-0 md:z-auto
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-surface-border">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shadow-lg shadow-accent/30">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path d="M3 4a1 1 0 0 0-1 1v.01L10 9.61l8-4.6V5a1 1 0 0 0-1-1H3Z" />
              <path d="m19 7.23-9 5.18-9-5.18V15a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7.23Z" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight text-white">Quantmail</span>
          {/* Close button (mobile only) */}
          <button
            onClick={onClose}
            className="ml-auto md:hidden text-gray-400 hover:text-white"
            aria-label="Close sidebar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Compose */}
        <div className="px-4 pt-4 pb-2">
          <button className="w-full flex items-center gap-2 justify-center rounded-xl bg-accent hover:bg-accent-light transition-colors py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/20">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Compose
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          <ul className="space-y-0.5">
            {navItems.map((item) => {
              const isActive = activeNav === item.id;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => { onNavChange(item.id); onClose(); }}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                      ${isActive
                        ? "bg-accent/15 text-accent-light"
                        : "text-gray-400 hover:bg-surface-hover hover:text-gray-200"
                      }
                    `}
                  >
                    <span className={isActive ? "text-accent-light" : "text-gray-500"}>
                      {icons[item.icon]}
                    </span>
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.count > 0 && (
                      <span className={`
                        text-xs px-1.5 py-0.5 rounded-md font-semibold
                        ${isActive ? "bg-accent/30 text-accent-light" : "bg-surface-border text-gray-400"}
                      `}>
                        {item.count}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User avatar */}
        <div className="px-4 py-4 border-t border-surface-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center text-xs font-bold text-white shadow">
              K
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-200 truncate">Kundan</p>
              <p className="text-xs text-gray-500 truncate">kundan@quantmail.app</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
