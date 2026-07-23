// Native replacements for the handful of material-ui 0.x components this app
// used. Prop contracts match the old components so call sites only swap the
// require: buttons take label/onClick/primary, Checkbox calls
// onCheck(event, isChecked), TextField calls onChange(event, newValue) and
// exposes the raw DOM node as ref.input. Styling lives in static/main.css.
const React = require('react')

class FlatButton extends React.Component {
  render () {
    const { className, style, label, onClick, autoFocus, disabled } = this.props
    return (
      <button
        type='button'
        className={'btn flat ' + (className || '')}
        style={style}
        onClick={onClick}
        autoFocus={autoFocus}
        disabled={disabled}
      >
        {label}
      </button>
    )
  }
}

class RaisedButton extends React.Component {
  render () {
    const { className, style, label, onClick, autoFocus, disabled, primary } = this.props
    return (
      <button
        type='button'
        className={'btn raised ' + (primary ? 'primary ' : '') + (className || '')}
        style={style}
        onClick={onClick}
        autoFocus={autoFocus}
        disabled={disabled}
      >
        {label}
      </button>
    )
  }
}

class Checkbox extends React.Component {
  render () {
    const { className, style, iconStyle, checked, onCheck, onClick, label } = this.props
    return (
      <label className={'checkbox ' + (className || '')} style={style} onClick={onClick}>
        <input
          type='checkbox'
          style={iconStyle}
          checked={!!checked}
          onChange={e => onCheck && onCheck(e, e.target.checked)}
        />
        {label ? <span className='checkbox-label'>{label}</span> : null}
      </label>
    )
  }
}

class TextField extends React.Component {
  render () {
    const {
      className, style, inputStyle, textareaStyle, id, value, hintText,
      onChange, onKeyDown, disabled, fullWidth, multiLine, rows
    } = this.props
    const common = {
      id,
      placeholder: hintText,
      disabled,
      value,
      readOnly: value !== undefined && !onChange,
      onKeyDown,
      onChange: onChange ? e => onChange(e, e.target.value) : undefined,
      ref: c => { this.input = c }
    }
    const rootStyle = Object.assign({}, fullWidth ? { width: '100%' } : null, style)
    return (
      <div className={'text-field ' + (className || '')} style={rootStyle}>
        {multiLine
          ? <textarea {...common} rows={rows} style={textareaStyle} />
          : <input type='text' {...common} style={inputStyle} />}
      </div>
    )
  }
}

class LinearProgress extends React.Component {
  render () {
    const { style, value } = this.props
    return (
      <div className='linear-progress' style={style}>
        <div className='linear-progress-bar' style={{ width: value + '%' }} />
      </div>
    )
  }
}

module.exports = { FlatButton, RaisedButton, Checkbox, TextField, LinearProgress }
