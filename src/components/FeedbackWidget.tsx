'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lightbulb, X, Send } from 'lucide-react';

export default function FeedbackWidget() {
  const t = useTranslations('feedback');
  const [isOpen, setIsOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState('general');
  const [message, setMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const subject = encodeURIComponent(`[Flowvium ${feedbackType}] Feedback`);
    const body = encodeURIComponent(`Type: ${feedbackType}\n\n${message}`);
    window.location.href = `mailto:taeshinkim11@gmail.com?subject=${subject}&body=${body}`;
    setMessage('');
    setFeedbackType('general');
    setIsOpen(false);
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 right-6 z-50 flex items-center justify-center
                    w-14 h-14 rounded-full shadow-lg
                    hover:shadow-xl hover:scale-105
                    active:scale-95 transition-all duration-300 ease-out
                    ${isOpen
                      ? 'opacity-0 pointer-events-none scale-90'
                      : 'opacity-100 scale-100'
                    }`}
        style={{ backgroundColor: '#6CB4A8', color: '#FFFFFF' }}
        aria-label={t('sendFeedback')}
      >
        <Lightbulb className="w-6 h-6" />
      </button>

      {/* Modal overlay */}
      <div
        className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 transition-all duration-300
                    ${isOpen
                      ? 'visible bg-black/20 backdrop-blur-sm'
                      : 'invisible bg-transparent'
                    }`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setIsOpen(false);
        }}
      >
        {/* Modal */}
        <div
          className={`w-full max-w-md bg-white rounded-xl shadow-xl overflow-hidden transition-all duration-300 ease-out
                      ${isOpen
                        ? 'opacity-100 translate-y-0 scale-100'
                        : 'opacity-0 translate-y-4 scale-95'
                      }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-cf-border">
            <div>
              <h3 className="text-base font-heading font-semibold text-cf-text-primary">
                {t('sendFeedback')}
              </h3>
              <p className="text-xs text-cf-text-secondary mt-0.5">
                {t('helpImprove')}
              </p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="flex items-center justify-center w-8 h-8 rounded-lg
                         text-cf-text-secondary hover:text-cf-text-primary hover:bg-gray-100
                         transition-all duration-200"
              aria-label={t('close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Type selector */}
            <div>
              <label className="block text-sm font-medium text-cf-text-primary mb-1.5">
                {t('feedbackType')}
              </label>
              <select
                value={feedbackType}
                onChange={(e) => setFeedbackType(e.target.value)}
                className="w-full rounded-lg border border-cf-border bg-white px-3 py-2 text-sm text-cf-text-primary focus:outline-none focus:ring-2 focus:ring-cf-primary/30 focus:border-cf-primary transition-colors"
              >
                <option value="bug">{t('bugReport')}</option>
                <option value="feature">{t('featureRequest')}</option>
                <option value="general">{t('generalFeedback')}</option>
              </select>
            </div>

            {/* Message */}
            <div>
              <label className="block text-sm font-medium text-cf-text-primary mb-1.5">
                {t('message')}
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('tellUs')}
                rows={4}
                required
                className="w-full rounded-lg border border-cf-border bg-white px-3 py-2 text-sm text-cf-text-primary placeholder:text-cf-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-cf-primary/30 focus:border-cf-primary transition-colors resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-cf-border text-sm font-medium text-cf-text-secondary hover:text-cf-text-primary hover:bg-gray-50 transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={!message.trim()}
                className="flex-1 px-4 py-2 rounded-lg bg-cf-primary text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-cf-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
                {t('submitBtn')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
