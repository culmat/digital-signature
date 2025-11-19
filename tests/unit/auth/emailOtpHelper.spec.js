const fs = require('fs');
const path = require('path');
const EmailOtpHelper = require('../../e2e/auth/emailOtpHelper');

describe('EmailOtpHelper.extractVerificationCode', () => {
  it('should extract the verification code YXEPXC from example_mail.html', () => {
    const html = fs.readFileSync(path.join(__dirname, 'example_mail.html'), 'utf8');
    const helper = new EmailOtpHelper({ user: 'dummy@example.com', password: 'dummy' });
    const code = helper.extractVerificationCode(html);
    expect(code).toBe('YXEPXC');
  });
});
