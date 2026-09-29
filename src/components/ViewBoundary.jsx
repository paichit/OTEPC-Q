import { Component } from 'react';

export default class ViewBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="error-box" role="alert">
      <p>หน้าจอมีข้อผิดพลาดระหว่างแสดงผล กรุณาลองเปิดหน้าใหม่ หากยังพบปัญหาให้แจ้งผู้ดูแลระบบ</p>
      <button className="secondary-button mt-3" onClick={() => window.location.reload()}>เปิดหน้าเว็บใหม่</button>
    </div>;
    return this.props.children;
  }
}
