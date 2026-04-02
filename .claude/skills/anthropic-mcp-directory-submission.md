---
description: Fill and submit the Anthropic MCP Directory Submission Form in Safari. Use when user asks to submit to Anthropic MCP directory, fill Anthropic directory form, or re-submit to Anthropic directory.
---

# Anthropic MCP Directory Submission Form

This skill automates filling the Anthropic MCP Directory Submission Google Form in Safari.

## Prerequisites
- Safari must be open with the MCP Directory Submission Form loaded
- Form URL: https://docs.google.com/forms/d/e/1FAIpQLSeafJF2NDI7oYx1r8o0ycivCSVLNq92Mpc1FPxMKSw1CzDkqA/formResponse

## Process

### Step 1: Read saved submission data
Read the memory file at `memory/mcp_directory_submission.md` to get all field values. If values need updating (e.g., tools list changed), gather current data from the codebase first.

### Step 2: Google Forms interaction techniques

**CRITICAL: These are the only methods that work with Google Forms in Safari via AppleScript.**

**Text inputs** — use native value setter:
```javascript
var inputs = document.querySelectorAll('.whsOnd.zHQkBf');
var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
nativeSetter.call(inputs[INDEX], 'VALUE');
inputs[INDEX].dispatchEvent(new Event('input', {bubbles: true}));
inputs[INDEX].dispatchEvent(new Event('change', {bubbles: true}));
```

**Textareas** — same pattern with HTMLTextAreaElement:
```javascript
var textareas = document.querySelectorAll('.KHxj8b.tL9Q4c');
var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
nativeSetter.call(textareas[INDEX], 'VALUE');
textareas[INDEX].dispatchEvent(new Event('input', {bubbles: true}));
textareas[INDEX].dispatchEvent(new Event('change', {bubbles: true}));
```

**Radio buttons & checkboxes** — MUST click via label, ONE PER osascript call:
```bash
osascript -e "tell application \"Safari\" to do JavaScript \"document.querySelector('label[for=\\\"ELEMENT_ID\\\"]').click(); 'done';\" in current tab of front window"
```

**IMPORTANT:**
- Clicking multiple labels in a single JavaScript execution does NOT work — only the first takes effect
- Each click must be a separate `osascript` call
- To find element IDs, query: `questions[INDEX].querySelectorAll('label[for]')` and inspect the `for` attribute

**Navigating pages** — find the Next/Back/Submit button:
```javascript
var buttons = document.querySelectorAll('[role=button]');
// List them to find correct index, then click
```

### Step 3: Fill each page

The form has 5 pages:
1. **Company & Server Details** — company info, server URL, description, auth config
2. **Test Account & Server Technical Details** — test credentials, tools list, resources list
3. **Launch Readiness & Media** — GA date, testing platforms, logo
4. **Skills & Plugins** — optional, can skip
5. **Submission Requirements Checklist** — all checkboxes must be checked

### Step 4: Verify before submit
After filling each page, verify selections stuck (especially radio/checkboxes). On the last page, let the user review and submit manually.

## Field Discovery

To map fields on any page:
```javascript
// Map text inputs
var inputs = document.querySelectorAll('.whsOnd.zHQkBf');
inputs.forEach(function(inp, i) {
    var c = inp.closest('.Qr7Oae');
    var l = c ? c.querySelector('.M7eMe') : null;
    console.log(i, l ? l.textContent.trim() : 'unknown');
});

// Map radio/checkbox options with their IDs
var questions = document.querySelectorAll('.Qr7Oae');
questions.forEach(function(q, i) {
    var label = q.querySelector('.M7eMe');
    var opts = q.querySelectorAll('label[for]');
    if (opts.length > 0) {
        opts.forEach(function(o) {
            console.log('Q' + i, label.textContent.trim(), o.getAttribute('for'), o.textContent.trim());
        });
    }
});
```

## Updating for resubmission

Before resubmitting, update these fields that may change:
- **Tools list** — scan `server.ts` for tool registrations
- **Resources list** — scan `server.ts` for resource registrations
- **Testing platforms** — confirm which platforms have been tested
- **Server description** — if features changed significantly
- **Tagline** — max 55 characters
